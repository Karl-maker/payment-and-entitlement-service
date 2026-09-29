terraform {
  backend "s3" {
    bucket         = "placeholder"
    key            = "placeholder"
    region         = "us-east-1"
    dynamodb_table = "placeholder"
    encrypt        = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

provider "aws" {
  region = "us-east-1"
}

data "terraform_remote_state" "foundation" {
  backend = "s3"

  config = {
    bucket = var.state_bucket_name
    key    = var.state_bucket_key
    region = var.state_region
  }
}

data "terraform_remote_state" "access_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-access-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
  }
}

data "aws_caller_identity" "current" {}

# SQS Dead Letter Queue
resource "aws_sqs_queue" "usage_event_dlq" {
  name = "${var.project_name}-${var.environment}-usage-event-dlq"

  tags = {
    Environment = var.environment
    Service     = "usage-event-service"
    Name        = "Usage Event DLQ"
  }
}

# SQS Queue for Usage Events (producers push directly; batch size 20)
resource "aws_sqs_queue" "usage_event_queue" {
  name                       = "${var.project_name}-${var.environment}-usage-event-queue"
  visibility_timeout_seconds  = 300
  message_retention_seconds   = 1209600
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.usage_event_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Environment = var.environment
    Service     = "usage-event-service"
    Name        = "Usage Event Queue"
  }
}

# Allow any principal in this AWS account to send messages (for app Lambdas, API, etc.)
resource "aws_sqs_queue_policy" "usage_event_queue_policy" {
  queue_url = aws_sqs_queue.usage_event_queue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSendFromAccount"
        Effect = "Allow"
        Principal = "*"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.usage_event_queue.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

module "usage_event_service_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "usage-event-service-lambda-role-${var.environment}"

  dynamodb_table_arns = [
    data.terraform_remote_state.access_service.outputs.entitlements_table_arn,
    "${data.terraform_remote_state.access_service.outputs.entitlements_table_arn}/index/*"
  ]

  tags = {
    Environment = var.environment
    Service     = "usage-event-service"
  }
}

resource "aws_iam_role_policy" "sqs_access" {
  name = "usage-event-service-sqs-access-${var.environment}"
  role = module.usage_event_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          aws_sqs_queue.usage_event_queue.arn,
          aws_sqs_queue.usage_event_dlq.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "sns_entitlement_updates" {
  name = "usage-event-service-sns-entitlement-updates-${var.environment}"
  role = module.usage_event_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = data.terraform_remote_state.access_service.outputs.entitlement_updates_topic_arn
      }
    ]
  })
}

module "usage_event_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-usage-event-service"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/usage-event-service/function.zip")
  iam_role_arn  = module.usage_event_service_iam_role.role_arn

  environment_variables = {
    ENTITLEMENTS_TABLE            = data.terraform_remote_state.access_service.outputs.entitlements_table_name
    ENTITLEMENT_UPDATES_TOPIC_ARN = data.terraform_remote_state.access_service.outputs.entitlement_updates_topic_arn
  }
}

resource "aws_lambda_event_source_mapping" "usage_event_queue_mapping" {
  event_source_arn                   = aws_sqs_queue.usage_event_queue.arn
  function_name                      = module.usage_event_lambda.function_arn
  batch_size                         = 20
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]
}
