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

# Parse secrets - handle both JSON and plain string formats
locals {
  jwt_access_token_secret = try(
    jsondecode(data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string)["key"],
    data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string
  )
}

# DynamoDB Table for Products
resource "aws_dynamodb_table" "products" {
  name         = "${var.project_name}-${var.environment}-products"
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

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  tags = {
    Environment = var.environment
    Service     = "product-service"
    Name        = "Products Table"
  }
}

# DynamoDB Table for Product Purchase Intent
resource "aws_dynamodb_table" "product_purchase_intent" {
  name         = "${var.project_name}-${var.environment}-product-purchase-intent"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  tags = {
    Environment = var.environment
    Service     = "product-service"
    Name        = "Product Purchase Intent Table"
  }
}

module "product_service_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "product-service-lambda-role-${var.environment}"
  
  dynamodb_table_arns = [
    aws_dynamodb_table.products.arn,
    "${aws_dynamodb_table.products.arn}/index/*",
    aws_dynamodb_table.product_purchase_intent.arn,
    "${aws_dynamodb_table.product_purchase_intent.arn}/index/*"
  ]

  tags = {
    Environment = var.environment
    Service     = "product-service"
  }
}

# Additional IAM Policy for Secrets Manager
resource "aws_iam_role_policy" "secrets_manager" {
  name = "product-service-secrets-manager-${var.environment}"
  role = module.product_service_iam_role.role_name

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

module "product_service_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-product-service"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.cwd}/services/product-service/function.zip")
  iam_role_arn  = module.product_service_iam_role.role_arn

  environment_variables = {
    PRODUCTS_TABLE           = aws_dynamodb_table.products.name
    JWT_ACCESS_TOKEN_SECRET  = local.jwt_access_token_secret
  }
}

module "lambda_api_link" {
  source = "../../modules/lambda_api_link"
  api_gateway_id      = data.terraform_remote_state.foundation.outputs.api_gateway_id
  api_gateway_root_id = data.terraform_remote_state.foundation.outputs.api_gateway_root_id
  lambda_function_arn  = module.product_service_lambda.function_arn
  lambda_function_name = module.product_service_lambda.function_name
  paths = ["products"]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = data.terraform_remote_state.foundation.outputs.api_gateway_id
    
  depends_on = [module.lambda_api_link]
}