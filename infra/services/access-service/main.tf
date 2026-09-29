terraform {
  backend "s3" {
    # Backend configuration is provided via -backend-config flags during terraform init
    # to support dynamic environment-based naming: [project-name]-[environment]-[service-name]-...
    bucket         = "placeholder" # Set via -backend-config
    key            = "placeholder" # Set via -backend-config
    region         = "us-east-1"   # Set via -backend-config
    dynamodb_table = "placeholder" # Set via -backend-config
    encrypt        = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 1.25.0"
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

# SNS Topic for Entitlement Updates (usage/availability changes). Consumed by downstream subscribers.
resource "aws_sns_topic" "entitlement_updates" {
  name = "${var.project_name}-${var.environment}-entitlement-updates-topic"

  tags = {
    Environment = var.environment
    Service     = "access-service"
    Name        = "Entitlement Updates Topic"
  }
}

# DynamoDB Table for Entitlements
resource "aws_dynamodb_table" "entitlements" {
  name         = "${var.project_name}-${var.environment}-entitlements"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  tags = {
    Environment = var.environment
    Service     = "access-service"
    Name        = "Entitlements Table"
  }
}

module "access_service_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "access-service-lambda-role-${var.environment}"
  
  # DynamoDB permissions for entitlements table
  dynamodb_table_arns = [
    aws_dynamodb_table.entitlements.arn,
    "${aws_dynamodb_table.entitlements.arn}/index/*"
  ]

  tags = {
    Environment = var.environment
    Service     = "access-service"
  }
}

# Additional IAM Policy for SNS Publish (entitlement updates)
resource "aws_iam_role_policy" "sns_entitlement_updates" {
  name = "access-service-sns-entitlement-updates-${var.environment}"
  role = module.access_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.entitlement_updates.arn
      }
    ]
  })
}

# Additional IAM Policy for Secrets Manager
resource "aws_iam_role_policy" "secrets_manager" {
  name = "access-service-secrets-manager-${var.environment}"
  role = module.access_service_iam_role.role_name

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

module "access_service_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-access-service"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/access-service/function.zip")
  iam_role_arn  = module.access_service_iam_role.role_arn

  environment_variables = {
    ENTITLEMENTS_TABLE           = aws_dynamodb_table.entitlements.name
    ENTITLEMENT_UPDATES_TOPIC_ARN = aws_sns_topic.entitlement_updates.arn
    JWT_ACCESS_TOKEN_SECRET      = local.jwt_access_token_secret
    ENVIRONMENT                  = var.environment
  }
}

module "lambda_api_link" {
  source = "../../modules/lambda_api_link"
  api_gateway_id      = data.terraform_remote_state.foundation.outputs.api_gateway_id
  api_gateway_root_id = data.terraform_remote_state.foundation.outputs.api_gateway_root_id
  lambda_function_arn  = module.access_service_lambda.function_arn
  lambda_function_name = module.access_service_lambda.function_name
  paths = ["access"]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = data.terraform_remote_state.foundation.outputs.api_gateway_id
    
  depends_on = [module.lambda_api_link]
}
