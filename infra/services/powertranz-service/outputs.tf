output "powertranz_intents_table_name" {
  value       = aws_dynamodb_table.powertranz_intents.name
  description = "Name of the PowerTranz payment intents DynamoDB table"
}

output "powertranz_intents_table_arn" {
  value       = aws_dynamodb_table.powertranz_intents.arn
  description = "ARN of the PowerTranz payment intents DynamoDB table"
}

output "lambda_function_arn" {
  value       = module.powertranz_service_lambda.function_arn
  description = "ARN of the PowerTranz service Lambda function"
}

output "lambda_function_name" {
  value       = module.powertranz_service_lambda.function_name
  description = "Name of the PowerTranz service Lambda function"
}
