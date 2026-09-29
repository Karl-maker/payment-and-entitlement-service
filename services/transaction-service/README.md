# Transaction Service

A serverless Lambda function service for recording and retrieving transaction history from billing events. This service listens to all billing events and maintains a complete transaction record.

## Overview

The Transaction Service processes billing events from SNS and records them as transactions in DynamoDB. It provides API endpoints for users to view their transaction history and for admins to view all transactions.

### Features

- **Event Recording**: Automatically records all billing events (payments, subscriptions) as transactions
- **User Transaction History**: Users can view their own transaction history
- **Admin Access**: Admin users can view all transactions across all users
- **Batch Processing**: Processes up to 20 events at a time from SQS
- **Dead Letter Queue**: Failed events are sent to DLQ for manual review
- **Complete Audit Trail**: Records all payment and subscription events with full metadata

## Architecture

The service follows a clean architecture pattern:

```
src/
├── app/                    # Application layer
│   ├── controllers/       # API Gateway request handlers
│   └── usecases/          # Business logic
├── handler/                # Lambda handlers
│   ├── sqs/               # SQS event handler (batch processing)
│   └── api-gateway/       # API Gateway handler
└── bootstrap.ts           # Dependency injection
```

## Environment Variables

### Required

- `TRANSACTIONS_TABLE` - Name of the DynamoDB table storing transactions
- `JWT_ACCESS_TOKEN_SECRET` - JWT secret for authentication (from AWS Secrets Manager, for API Gateway only)

## API Endpoints

### Get User Transactions

**Endpoint**: `GET /transactions?userId={userId}`

**Headers**:
- `Authorization: Bearer <jwt_token>` (required)

**Query Parameters**:
- `userId` (optional) - The user ID to get transactions for. If not provided, uses the authenticated user's ID. Users can only view their own transactions unless they're admin.
- `limit` (optional) - Maximum number of transactions to return (default: 100)
- `provider` (optional) - Filter transactions by payment provider. Supported values: `stripe`, `powertranz`
- `cursor` (optional) - Cursor returned by the previous `/transactions` response to fetch the next page

**Response** (200 OK):
```json
{
  "userId": "user-123",
  "transactions": [
    {
      "transactionId": "pi_abc123",
      "type": "payment.successful",
      "status": "success",
      "amount": 29.99,
      "currency": "USD",
      "productId": "prod-premium-plan",
      "priceId": "price_xyz",
      "subscriptionId": null,
      "provider": "powertranz",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "metadata": {
        "eventId": "evt_123",
        "billingType": "one_time",
        "provider": "powertranz"
      }
    }
  ],
  "count": 1,
  "hasMore": true,
  "nextCursor": "eyJ1c2VySWQiOiJ1c2VyLTEyMyIsInByb3ZpZGVyIjoicG93ZXJ0cmFueiIsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWiIsInRyYW5zYWN0aW9uSWQiOiJwaV9hYmMxMjMifQ=="
}
```

**Error Responses**:

- `400 Bad Request`: Missing userId or invalid limit
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User trying to view another user's transactions (non-admin)

**Example**:
```bash
# Get own transactions
curl -X GET "https://api.example.com/transactions" \
  -H "Authorization: Bearer <jwt_token>"

# Get Powertranz transactions only
curl -X GET "https://api.example.com/transactions?provider=powertranz&limit=20" \
  -H "Authorization: Bearer <jwt_token>"

# Get the next page using the returned cursor
curl -X GET "https://api.example.com/transactions?provider=powertranz&limit=20&cursor=<nextCursor>" \
  -H "Authorization: Bearer <jwt_token>"

# Get specific user's transactions (admin only)
curl -X GET "https://api.example.com/transactions?userId=user-123" \
  -H "Authorization: Bearer <jwt_token>"
```

### Get All Transactions (Admin Only)

**Endpoint**: `GET /transactions/all`

**Headers**:
- `Authorization: Bearer <jwt_token>` (required)
- User must have `ADMIN` role

**Query Parameters**:
- `limit` (optional) - Maximum number of transactions to return (default: 100)

**Response** (200 OK):
```json
{
  "transactions": [
    {
      "transactionId": "pi_abc123",
      "userId": "user-123",
      "type": "payment.successful",
      "status": "success",
      "amount": 29.99,
      "currency": "USD",
      "productId": "prod-premium-plan",
      "priceId": "price_xyz",
      "subscriptionId": null,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "metadata": {
        "eventId": "evt_123",
        "billingType": "one_time"
      }
    }
  ],
  "count": 1
}
```

**Error Responses**:

- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not have ADMIN role

**Example**:
```bash
curl -X GET "https://api.example.com/transactions/all?limit=50" \
  -H "Authorization: Bearer <jwt_token>"
```

## Transaction Types

The service records the following transaction types:

- `payment.successful` - Successful payment (one-time or subscription)
- `payment.failed` - Failed payment attempt
- `payment.action_required` - Payment requires user action
- `subscription.created` - New subscription created
- `subscription.updated` - Subscription updated (product change, add-on, etc.)
- `subscription.canceled` - Subscription canceled (still active until period end)
- `subscription.expired` - Subscription expired (period ended)

## Transaction Status

Each transaction has a status:

- `success` - Transaction completed successfully
- `failed` - Transaction failed
- `pending` - Transaction is pending (e.g., canceled subscription still active)
- `action_required` - User action required to complete transaction

## How It Works

### Event Processing Flow

1. **Billing Event Published**: Stripe service publishes billing events to SNS
2. **SQS Receives Events**: Transaction service SQS queue receives events from SNS
3. **Batch Processing**: Lambda processes up to 20 events at a time
4. **Transaction Creation**: Each event is converted to a Transaction entity
5. **Storage**: Transactions are saved to DynamoDB
6. **Error Handling**: Failed events are sent to DLQ for manual review

### Transaction Recording

When a billing event is received:

1. **Event Type Mapping**: Billing event type is mapped to transaction type
2. **Transaction Creation**: Transaction entity is created with:
   - Transaction ID (paymentIntentId or subscriptionId)
   - User ID
   - Type and status
   - Amount and currency
   - Product and price IDs
   - Subscription ID (if applicable)
   - Full event metadata
3. **Storage**: Transaction is saved to DynamoDB with composite key:
   - PK: `USER#{userId}`
   - SK: `TRANSACTION#{transactionId}#{timestamp}`

### Access Control

- **Regular Users**: Can only view their own transactions (userId query parameter is ignored)
- **Admin Users**: Can filter by `userId` query parameter to view any user's transactions
- **Unauthorized Access**: Returns 403 Forbidden if non-admin user tries to filter by different userId

## DynamoDB Schema

### Transactions Table

**Primary Key**:
- `PK` (Partition Key): `USER#{userId}`
- `SK` (Sort Key): `TRANSACTION#{transactionId}#{createdAt}`

**Attributes**:
- `transactionId` (String) - Unique transaction identifier
- `userId` (String) - User who made the transaction
- `type` (String) - Transaction type (e.g., "payment.successful")
- `status` (String) - Transaction status (success, failed, pending, action_required)
- `amount` (Number) - Transaction amount
- `currency` (String) - Currency code (e.g., "USD")
- `productId` (String, optional) - Product ID
- `priceId` (String, optional) - Price ID
- `subscriptionId` (String, optional) - Subscription ID
- `createdAt` (String - ISO 8601) - When transaction was recorded
- `metadata` (String - JSON) - Additional event-specific data

## SQS Configuration

### Queue Settings

- **Batch Size**: 20 messages per Lambda invocation
- **Visibility Timeout**: 300 seconds (5 minutes)
- **Message Retention**: 14 days
- **Long Polling**: 20 seconds
- **Max Receive Count**: 3 (before sending to DLQ)

### Dead Letter Queue

Failed events are sent to DLQ after 3 failed processing attempts. DLQ messages should be manually reviewed and reprocessed if needed.

## Integration with Other Services

### Input: Billing Events (from SNS)

The service subscribes to the billing events SNS topic published by:
- **Stripe Service**: Publishes payment and subscription events
- **Entitlement Service**: May publish additional billing-related events

### Output: Transaction Records

Transactions are stored in DynamoDB and can be queried via:
- **API Gateway**: REST endpoints for viewing transactions
- **Direct DynamoDB Access**: For reporting and analytics

## Deployment

The service is deployed using Terraform with the following resources:

- **DynamoDB Table**: `{project-name}-{environment}-transactions`
- **SQS Queue**: `{project-name}-{environment}-transaction-queue` (with batch size 20)
- **SQS DLQ**: `{project-name}-{environment}-transaction-dlq`
- **Lambda Function (SQS)**: `transaction-service` (processes SQS events)
- **Lambda Function (API)**: `transaction-service-api` (handles API Gateway requests)
- **API Gateway**: Integrated with existing API Gateway
- **IAM Role**: Permissions for DynamoDB, SQS, and Secrets Manager

## Monitoring

Key metrics to monitor:

- **Transaction Recording Rate**: How many transactions are recorded per day
- **Processing Errors**: Failed event processing (check DLQ)
- **API Usage**: Number of transaction queries
- **Latency**: Time to process events and serve API requests

## Troubleshooting

### Common Issues

**Issue**: Transactions not being recorded
- **Cause**: SQS queue not receiving events from SNS
- **Solution**: Check SNS subscription and SQS queue policy

**Issue**: "Unauthorized" when viewing transactions
- **Cause**: User trying to view another user's transactions (non-admin)
- **Solution**: Users can only view their own transactions unless they have ADMIN role

**Issue**: Events in DLQ
- **Cause**: Event processing failed 3 times
- **Solution**: Review DLQ messages, check logs, and reprocess if needed

## Related Services

- **Stripe Service**: Publishes billing events that are recorded as transactions
- **Entitlement Service**: May publish billing-related events
- **Access Service**: Provides user authentication for API endpoints
