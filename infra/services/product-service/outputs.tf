output "products_table_name" {
  value       = aws_dynamodb_table.products.name
  description = "Name of the products DynamoDB table"
}

output "products_table_arn" {
  value       = aws_dynamodb_table.products.arn
  description = "ARN of the products DynamoDB table"
}

output "products_table_id" {
  value       = aws_dynamodb_table.products.id
  description = "ID of the products DynamoDB table"
}

output "products_table_details" {
  value = {
    name         = aws_dynamodb_table.products.name
    arn          = aws_dynamodb_table.products.arn
    id           = aws_dynamodb_table.products.id
    hash_key     = aws_dynamodb_table.products.hash_key
    range_key    = aws_dynamodb_table.products.range_key
    billing_mode = aws_dynamodb_table.products.billing_mode
  }
  description = "Complete details of the products DynamoDB table for use by other services"
}

output "product_purchase_intent_table_name" {
  value       = aws_dynamodb_table.product_purchase_intent.name
  description = "Name of the product purchase intent DynamoDB table"
}

output "lambda_function_arn" {
  value       = module.product_service_lambda.function_arn
  description = "ARN of the product service Lambda function"
}

output "lambda_function_name" {
  value       = module.product_service_lambda.function_name
  description = "Name of the product service Lambda function"
}
