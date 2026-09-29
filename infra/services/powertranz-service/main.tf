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

data "terraform_remote_state" "entitlement_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-entitlement-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "transaction_service" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-${var.environment}-transaction-service-state"
    key    = "tf-infra/${var.environment}.tfstate"
    region = "us-east-1"
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_sqs_queue" "email_queue" {
  name = "${var.project_name}-${var.environment}-email-service-queue"
}

data "aws_secretsmanager_secret" "powertranz_merchant_id" {
  name = "${var.project_name}-${var.environment}-powertranz-merchant-id"
}

data "aws_secretsmanager_secret_version" "powertranz_merchant_id" {
  secret_id = data.aws_secretsmanager_secret.powertranz_merchant_id.id
}

data "aws_secretsmanager_secret" "powertranz_merchant_password" {
  name = "${var.project_name}-${var.environment}-powertranz-merchant-password"
}

data "aws_secretsmanager_secret_version" "powertranz_merchant_password" {
  secret_id = data.aws_secretsmanager_secret.powertranz_merchant_password.id
}

data "aws_secretsmanager_secret" "powertranz_callback_secret" {
  name = "${var.project_name}-${var.environment}-powertranz-callback-secret"
}

data "aws_secretsmanager_secret_version" "powertranz_callback_secret" {
  secret_id = data.aws_secretsmanager_secret.powertranz_callback_secret.id
}

data "aws_secretsmanager_secret" "jwt_access_token_secret" {
  name = "${var.project_name}-${var.environment}-jwt-access-token-secret"
}

data "aws_secretsmanager_secret_version" "jwt_access_token_secret" {
  secret_id = data.aws_secretsmanager_secret.jwt_access_token_secret.id
}

locals {
  powertranz_merchant_id = try(
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_id.secret_string)["merchantId"],
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_id.secret_string)["id"],
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_id.secret_string)["key"],
    data.aws_secretsmanager_secret_version.powertranz_merchant_id.secret_string
  )

  powertranz_merchant_password = try(
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_password.secret_string)["merchantPassword"],
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_password.secret_string)["password"],
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_merchant_password.secret_string)["key"],
    data.aws_secretsmanager_secret_version.powertranz_merchant_password.secret_string
  )

  powertranz_callback_secret = try(
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_callback_secret.secret_string)["secret"],
    jsondecode(data.aws_secretsmanager_secret_version.powertranz_callback_secret.secret_string)["key"],
    data.aws_secretsmanager_secret_version.powertranz_callback_secret.secret_string
  )

  jwt_access_token_secret = try(
    jsondecode(data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string)["key"],
    data.aws_secretsmanager_secret_version.jwt_access_token_secret.secret_string
  )

  api_stage_name = lookup({
    dev         = "dev"
    development = "dev"
    staging     = "staging"
    prod        = "prod"
    production  = "prod"
    main        = "prod"
  }, lower(var.environment), var.environment)

  api_custom_domain_url = try(trimsuffix(data.terraform_remote_state.foundation.outputs.api_custom_domain_url, "/"), "")
  api_execute_url       = "https://${data.terraform_remote_state.foundation.outputs.api_gateway_id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${local.api_stage_name}"
  api_base_url          = local.api_custom_domain_url != "" ? "${local.api_custom_domain_url}/v1" : local.api_execute_url

  powertranz_merchant_response_url = "${local.api_base_url}/powertranz/callback"
}

resource "aws_dynamodb_table" "powertranz_intents" {
  name         = "${var.project_name}-${var.environment}-powertranz-intents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "spiToken"

  attribute {
    name = "spiToken"
    type = "S"
  }

  tags = {
    Environment = var.environment
    Service     = "powertranz-service"
    Name        = "PowerTranz Payment Intents"
  }
}

module "powertranz_service_iam_role" {
  source = "../../modules/lambda_iam_role"

  role_name = "powertranz-service-lambda-role-${var.environment}"

  dynamodb_table_arns = [
    aws_dynamodb_table.powertranz_intents.arn,
    data.terraform_remote_state.product_service.outputs.products_table_arn,
    "${data.terraform_remote_state.product_service.outputs.products_table_arn}/index/*",
    data.terraform_remote_state.pricing_service.outputs.prices_table_arn,
    "${data.terraform_remote_state.pricing_service.outputs.prices_table_arn}/index/*",
    data.terraform_remote_state.transaction_service.outputs.transactions_table_arn,
  ]

  tags = {
    Environment = var.environment
    Service     = "powertranz-service"
  }
}

resource "aws_iam_role_policy" "sns_publish" {
  name = "powertranz-service-sns-publish-${var.environment}"
  role = module.powertranz_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = data.terraform_remote_state.entitlement_service.outputs.billing_events_topic_arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "sqs_send_email" {
  name = "powertranz-service-sqs-email-${var.environment}"
  role = module.powertranz_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = data.aws_sqs_queue.email_queue.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "secrets_manager" {
  name = "powertranz-service-secrets-manager-${var.environment}"
  role = module.powertranz_service_iam_role.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.powertranz_merchant_id.arn,
          data.aws_secretsmanager_secret.powertranz_merchant_password.arn,
          data.aws_secretsmanager_secret.powertranz_callback_secret.arn,
          data.aws_secretsmanager_secret.jwt_access_token_secret.arn,
        ]
      }
    ]
  })
}

module "powertranz_service_lambda" {
  source = "../../modules/lambda"

  function_name = "${var.project_name}-${var.environment}-powertranz-service"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = abspath("${path.module}/../../../services/powertranz-service/function.zip")
  iam_role_arn  = module.powertranz_service_iam_role.role_arn
  timeout       = 30
  memory_size   = 256

  environment_variables = {
    POWERTRANZ_BASE_URL              = var.powertranz_base_url
    POWERTRANZ_MERCHANT_ID           = local.powertranz_merchant_id
    POWERTRANZ_MERCHANT_PASSWORD     = local.powertranz_merchant_password
    POWERTRANZ_CALLBACK_SECRET       = local.powertranz_callback_secret
    POWERTRANZ_MERCHANT_RESPONSE_URL = local.powertranz_merchant_response_url
    POWERTRANZ_BILLING_REDIRECT_BASE_URL = var.powertranz_billing_redirect_base_url
    POWERTRANZ_3DS_ENABLED           = tostring(var.powertranz_3ds_enabled)
    POWERTRANZ_ALLOW_NON_3DS_FALLBACK = tostring(var.powertranz_allow_non_3ds_fallback)
    POWERTRANZ_HPP_PAGE_SET          = var.powertranz_hpp_page_set
    POWERTRANZ_HPP_PAGE_NAME         = var.powertranz_hpp_page_name
    USD_TTD_EXCHANGE_RATE            = tostring(var.usd_ttd_exchange_rate)
    POWERTRANZ_INTENTS_TABLE_NAME    = aws_dynamodb_table.powertranz_intents.name
    PRODUCTS_TABLE                   = data.terraform_remote_state.product_service.outputs.products_table_name
    PRICES_TABLE                     = data.terraform_remote_state.pricing_service.outputs.prices_table_name
    TRANSACTIONS_TABLE               = data.terraform_remote_state.transaction_service.outputs.transactions_table_name
    BILLING_EVENTS_TOPIC_ARN         = data.terraform_remote_state.entitlement_service.outputs.billing_events_topic_arn
    EMAIL_QUEUE_URL                  = data.aws_sqs_queue.email_queue.url
    JWT_ACCESS_TOKEN_SECRET          = local.jwt_access_token_secret
  }
}

module "lambda_api_link" {
  source = "../../modules/lambda_api_link"

  api_gateway_id       = data.terraform_remote_state.foundation.outputs.api_gateway_id
  api_gateway_root_id  = data.terraform_remote_state.foundation.outputs.api_gateway_root_id
  lambda_function_arn  = module.powertranz_service_lambda.function_arn
  lambda_function_name = module.powertranz_service_lambda.function_name
  paths                = ["powertranz"]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = data.terraform_remote_state.foundation.outputs.api_gateway_id

  depends_on = [module.lambda_api_link]
}
