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

# Look up billing events SNS topic by name (created by entitlement-service but we don't need remote state)
data "aws_sns_topic" "billing_events" {
  name = "${var.project_name}-${var.environment}-billing-events"
}

# Look up entitlement updates SNS topic by name (for publishing revocation events)
data "aws_sns_topic" "entitlement_updates" {
  name = "${var.project_name}-${var.environment}-entitlement-updates-topic"
}

# No dependencies on other services - uses libs/domain for shared functionality

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Get JWT secret from AWS Secrets Manager
data "aws_secretsmanager_secret" "jwt_access_token_secret" {
  name = "${var.project_name}-${var.environment}-jwt-access-token-secret"
}

data "aws_secretsmanager_secret_version" "jwt_access_token_secret" {
  secret_id = data.aws_secretsmanager_secret.jwt_access_token_secret.id
}

locals {
  jwt_access_token_secret = try(
    jsondecode(data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string)["key"],
    data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string
  )
}

# DynamoDB Table for Dunning Records
resource "aws_dynamodb_table" "dunning" {
  name         = "${var.project_name}-${var.environment}-dunning"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = {
    Environment = var.environment
    Service     = "dunning-service"
    Name        = "Dunning Records Table"
  }
}

# SQS Dead Letter Queue
resource "aws_sqs_queue" "dunning_dlq" {
  name = "${var.project_name}-${var.environment}-dunning-dlq"

  tags = {
    Environment = var.environment
    Service     = "dunning-service"
    Name        = "Dunning DLQ"
  }
}

# SQS Queue for Dunning Service
resource "aws_sqs_queue" "dunning_queue" {
  name                       = "${var.project_name}-${var.environment}-dunning-queue"
  visibility_timeout_seconds = 300  # 5 minutes
  message_retention_seconds  = 1209600  # 14 days
  receive_wait_time_seconds  = 20  # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dunning_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Environment = var.environment
    Service     = "dunning-service"
    Name        = "Dunning Queue"
  }
}

# SQS Queue Policy to allow SNS to send messages
resource "aws_sqs_queue_policy" "dunning_queue_policy" {
  queue_url = aws_sqs_queue.dunning_queue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "sns.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.dunning_queue.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = data.aws_sns_topic.billing_events.arn
          }
        }
      }
    ]
  })
}

# SNS Subscription: SQS Queue subscribes to Billing Events Topic
resource "aws_sns_topic_subscription" "billing_events_to_dunning_sqs" {
  topic_arn = data.aws_sns_topic.billing_events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.dunning_queue.arn
}

# IAM Role for Dunning Service Lambda (SQS Handler)
module "dunning_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "dunning-lambda-role-${var.environment}"

  # DynamoDB permissions - only dunning table (entitlements handled via events)
  dynamodb_table_arns = [
    aws_dynamodb_table.dunning.arn
  ]

  tags = {
    Environment = var.environment
    Service     = "dunning-service"
  }
}

# Additional IAM Policy for SNS Publishing (for entitlement revocation events)
resource "aws_iam_role_policy" "sns_publish" {
  name = "dunning-sns-publish-${var.environment}"
  role = module.dunning_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = data.aws_sns_topic.entitlement_updates.arn
      }
    ]
  })
}

# Additional IAM Policy for SQS
resource "aws_iam_role_policy" "sqs_access" {
  name = "dunning-sqs-access-${var.environment}"
  role = module.dunning_iam_role.role_name

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
        Resource = aws_sqs_queue.dunning_queue.arn
      }
    ]
  })
}

# Additional IAM Policy for Secrets Manager (for JWT)
resource "aws_iam_role_policy" "secrets_manager" {
  name = "dunning-secrets-manager-${var.environment}"
  role = module.dunning_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.jwt_access_token_secret.arn
        ]
      }
    ]
  })
}

# Lambda Function for SQS Handler
module "dunning_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-dunning-service"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/dunning-service/function.zip")
  iam_role_arn  = module.dunning_iam_role.role_arn

  environment_variables = {
    DUNNING_TABLE                    = aws_dynamodb_table.dunning.name
    ENTITLEMENT_UPDATES_TOPIC_ARN    = data.aws_sns_topic.entitlement_updates.arn
  }
}

# Lambda Event Source Mapping (SQS Trigger)
resource "aws_lambda_event_source_mapping" "dunning_sqs_trigger" {
  event_source_arn = aws_sqs_queue.dunning_queue.arn
  function_name    = module.dunning_lambda.function_arn
  batch_size       = 10
  maximum_batching_window_in_seconds = 5

  function_response_types = ["ReportBatchItemFailures"]
}

# Lambda Function for API Gateway Handler
module "dunning_api_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-dunning-service-api"
  handler       = "api-gateway.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/dunning-service/function.zip")
  iam_role_arn  = module.dunning_iam_role.role_arn

  environment_variables = {
    DUNNING_TABLE                 = aws_dynamodb_table.dunning.name
    JWT_ACCESS_TOKEN_SECRET        = local.jwt_access_token_secret
    ENTITLEMENT_UPDATES_TOPIC_ARN = data.aws_sns_topic.entitlement_updates.arn
  }
}

# API Gateway Integration
module "dunning_lambda_api_link" {
  source = "../../modules/lambda_api_link"
  api_gateway_id      = data.terraform_remote_state.foundation.outputs.api_gateway_id
  api_gateway_root_id = data.terraform_remote_state.foundation.outputs.api_gateway_root_id
  lambda_function_arn  = module.dunning_api_lambda.function_arn
  lambda_function_name = module.dunning_api_lambda.function_name
  paths = ["dunning"]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = data.terraform_remote_state.foundation.outputs.api_gateway_id
    
  depends_on = [module.dunning_lambda_api_link]
}
