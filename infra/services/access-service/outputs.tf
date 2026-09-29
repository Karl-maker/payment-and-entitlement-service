output "entitlement_updates_topic_arn" {
  value       = aws_sns_topic.entitlement_updates.arn
  description = "ARN of the entitlement updates SNS topic (usage/availability changes)"
}

output "entitlement_updates_topic_name" {
  value       = aws_sns_topic.entitlement_updates.name
  description = "Name of the entitlement updates SNS topic"
}

output "entitlements_table_name" {
  value       = aws_dynamodb_table.entitlements.name
  description = "Name of the entitlements DynamoDB table"
}

output "entitlements_table_arn" {
  value       = aws_dynamodb_table.entitlements.arn
  description = "ARN of the entitlements DynamoDB table"
}

output "entitlements_table_id" {
  value       = aws_dynamodb_table.entitlements.id
  description = "ID of the entitlements DynamoDB table"
}

output "entitlements_table_stream_arn" {
  value       = aws_dynamodb_table.entitlements.stream_arn
  description = "Stream ARN of the entitlements DynamoDB table (if streams are enabled)"
}

output "entitlements_table_details" {
  value = {
    name         = aws_dynamodb_table.entitlements.name
    arn          = aws_dynamodb_table.entitlements.arn
    id           = aws_dynamodb_table.entitlements.id
    hash_key     = aws_dynamodb_table.entitlements.hash_key
    range_key    = aws_dynamodb_table.entitlements.range_key
    billing_mode = aws_dynamodb_table.entitlements.billing_mode
  }
  description = "Complete details of the entitlements DynamoDB table for use by other services"
}
