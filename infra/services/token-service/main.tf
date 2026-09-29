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

data "terraform_remote_state" "product_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-product-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "pricing_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-pricing-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
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

data "terraform_remote_state" "entitlement_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-entitlement-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
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

module "token_service_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "token-service-lambda-role-${var.environment}"
  
  # DynamoDB permissions for entitlements, products, and prices tables
  dynamodb_table_arns = [
    data.terraform_remote_state.access_service.outputs.entitlements_table_arn,
    "${data.terraform_remote_state.access_service.outputs.entitlements_table_arn}/index/*",
    data.terraform_remote_state.product_service.outputs.products_table_arn,
    "${data.terraform_remote_state.product_service.outputs.products_table_arn}/index/*",
    data.terraform_remote_state.pricing_service.outputs.prices_table_arn,
    "${data.terraform_remote_state.pricing_service.outputs.prices_table_arn}/index/*",
    data.terraform_remote_state.entitlement_service.outputs.processed_events_table_arn,
  ]

  tags = {
    Environment = var.environment
    Service     = "token-service"
  }
}

# Additional IAM Policy for Secrets Manager
resource "aws_iam_role_policy" "secrets_manager" {
  name = "token-service-secrets-manager-${var.environment}"
  role = module.token_service_iam_role.role_name

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

# Additional IAM Policy for SNS Publishing (billing events + entitlement updates)
resource "aws_iam_role_policy" "sns_publish" {
  name = "token-service-sns-publish-${var.environment}"
  role = module.token_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["sns:Publish"]
        Resource = data.terraform_remote_state.entitlement_service.outputs.billing_events_topic_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = data.terraform_remote_state.access_service.outputs.entitlement_updates_topic_arn
      }
    ]
  })
}

module "token_service_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-token-service"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/token-service/function.zip")
  iam_role_arn  = module.token_service_iam_role.role_arn

  environment_variables = {
    ENTITLEMENTS_TABLE            = data.terraform_remote_state.access_service.outputs.entitlements_table_name
    PRODUCTS_TABLE               = data.terraform_remote_state.product_service.outputs.products_table_name
    PRICES_TABLE                  = data.terraform_remote_state.pricing_service.outputs.prices_table_name
    PROCESSED_EVENTS_TABLE        = data.terraform_remote_state.entitlement_service.outputs.processed_events_table_name
    BILLING_EVENTS_TOPIC_ARN      = data.terraform_remote_state.entitlement_service.outputs.billing_events_topic_arn
    ENTITLEMENT_UPDATES_TOPIC_ARN = data.terraform_remote_state.access_service.outputs.entitlement_updates_topic_arn
    JWT_ACCESS_TOKEN_SECRET       = local.jwt_access_token_secret
  }
}

module "lambda_api_link" {
  source = "../../modules/lambda_api_link"
  api_gateway_id      = data.terraform_remote_state.foundation.outputs.api_gateway_id
  api_gateway_root_id = data.terraform_remote_state.foundation.outputs.api_gateway_root_id
  lambda_function_arn  = module.token_service_lambda.function_arn
  lambda_function_name = module.token_service_lambda.function_name
  paths = ["token"]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = data.terraform_remote_state.foundation.outputs.api_gateway_id
    
  depends_on = [module.lambda_api_link]
}
