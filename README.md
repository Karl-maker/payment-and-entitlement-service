# Payment Service Platform

A serverless microservices platform for managing products, pricing, entitlements, and billing events in a payment system. Built with AWS Lambda, API Gateway, DynamoDB, SNS, and SQS.

## Configuration

### Project Name

All AWS resources (DynamoDB tables, S3 buckets, SNS topics, Secrets Manager secrets, etc.) are prefixed with a configurable project name. This allows you to customize resource naming for your organization and avoid naming conflicts.

**To configure the project name:**

1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. Click **New repository variable**
3. Add:
   - **Name**: `PROJECT_NAME`
   - **Value**: Your project name (e.g., `my-company`, `acme-corp`, `eislett-education`)
   - **Visibility**: Repository (or Organization if you want to share across repos)
4. Click **Add variable**

**Default**: If `PROJECT_NAME` is not set, it defaults to `eislett-education`.

**Resource naming format**: `{project-name}-{environment}-{resource-type}`

**Examples**:
- With default (`eislett-education`): 
  - DynamoDB: `eislett-education-dev-products`
  - S3: `eislett-education-dev-product-service-state`
  - Secrets: `eislett-education-dev-stripe-secret-key`
- With custom (`my-company`):
  - DynamoDB: `my-company-dev-products`
  - S3: `my-company-dev-product-service-state`
  - Secrets: `my-company-dev-stripe-secret-key`

**Important Notes**:
- The project name is used in **all** Terraform resource names
- Changing the project name will create **new** resources (old ones won't be automatically renamed)
- Ensure all team members use the same `PROJECT_NAME` value
- The project name must be valid for AWS resource naming (lowercase, alphanumeric, hyphens only)

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Services](#services)
- [Service Communication](#service-communication)
- [Data Flow](#data-flow)
- [Infrastructure](#infrastructure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Additional Docs](#additional-docs)

## Overview

This platform provides a complete payment and entitlement management system for education services. It consists of four main microservices that work together to manage products, pricing, user entitlements, and automatic entitlement processing based on billing events.

## Additional Docs

- [Learner catalog endpoints](docs/learner-catalog-endpoints.md) documents the learner API subject, topic, and sub-topic endpoints that can be used alongside payment and entitlement flows.

### Key Features

- **Product Management**: Full CRUD operations for products (subscriptions, one-off purchases, add-ons)
- **Pricing Management**: Flexible pricing with recurring and one-time billing options
- **Entitlement Management**: Automatic entitlement creation/updates based on billing events
- **Event-Driven Architecture**: Asynchronous processing using SNS/SQS
- **Secure Access**: JWT-authenticated API for retrieving user entitlements
- **Idempotency**: Event tracking to prevent duplicate processing

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                              │
│  (Shared REST API for all HTTP services)                        │
└────────────┬──────────────┬──────────────┬─────────────────────┘
             │              │              │
    ┌────────▼────┐  ┌──────▼──────┐  ┌───▼──────────┐
    │  Product    │  │   Pricing   │  │   Access     │
    │  Service    │  │   Service   │  │   Service    │
    │  (Lambda)   │  │  (Lambda)   │  │  (Lambda)    │
    └──────┬──────┘  └──────┬──────┘  └──────┬───────┘
           │                │                 │
           │                │                 │
    ┌──────▼───────────────▼─────────────────▼──────┐
    │           DynamoDB Tables                         │
    │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
    │  │ Products │  │  Prices  │  │ Entitlements │   │
    │  └──────────┘  └──────────┘  └──────────────┘   │
    └───────────────────────────────────────────────────┘
                          │
                          │ (Reads)
                          │
           ┌──────────────▼──────────────┐
           │  Entitlement Processor      │
           │  Service (Lambda)           │
           │  (Triggered by SQS)          │
           └──────────────┬───────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼──────┐  ┌──────▼──────┐  ┌──────▼────────┐
│   SNS Topic   │  │  SQS Queue  │  │  Processed    │
│ billing-events│  │ (with DLQ)  │  │  Events Table │
└───────┬───────┘  └─────────────┘  └───────────────┘
        │
        │ (Publishes)
        │
┌───────▼───────────────────────────────┐
│  Entitlement Updates SNS Topic        │
│  (For other services to subscribe)    │
└───────────────────────────────────────┘
```

## Services

### 1. Product Service

**Purpose**: Manages product catalog and configurations

**Responsibilities**:
- Create, read, update, delete products
- Search and list products with pagination
- Manage product types (subscription, one-off, add-on)
- Configure entitlements, usage limits, and add-on relationships

**API Endpoints** (via API Gateway):
- `POST /products` - Create product
- `GET /products/{id}` - Get product
- `PUT /products/{id}` - Update product
- `DELETE /products/{id}` - Delete product
- `GET /products` - List products (paginated)
- `GET /products/search` - Search products

**Data Store**: DynamoDB (`products` table)

**Dependencies**: None (foundational service)

---

### 2. Pricing Service

**Purpose**: Manages pricing information for products

**Responsibilities**:
- Create, read, update, delete prices
- Associate prices with products
- Support recurring and one-time billing
- Configure billing intervals (day, week, month, year)
- Manage multiple payment providers per price

**API Endpoints** (via API Gateway):
- `POST /prices` - Create price
- `GET /prices/{id}` - Get price
- `PUT /prices/{id}` - Update price
- `DELETE /prices/{id}` - Delete price
- `GET /prices/product/{productId}` - List prices by product

**Data Store**: DynamoDB (`prices` table)

**Dependencies**: None (foundational service)

---

### 3. Access Service

**Purpose**: Provides secure access to user entitlements

**Responsibilities**:
- Retrieve user entitlements (JWT-authenticated)
- Filter entitlements by role
- Return usage limits and consumption data
- Validate JWT tokens

**API Endpoints** (via API Gateway):
- `GET /access/entitlements` - Get user entitlements (requires JWT)

**Authentication**: JWT Bearer token in Authorization header

**Data Store**: DynamoDB (`entitlements` table)

**Dependencies**: 
- Reads from `entitlements` table (managed by Entitlement Processor Service)

---

### 4. Entitlement Processor Service

**Purpose**: Automatically processes billing events to manage entitlements

**Responsibilities**:
- Process billing events from SQS
- Create entitlements when subscriptions/payments succeed
- Update entitlements when subscriptions change
- Revoke entitlements on cancellation/expiration
- Handle add-on products
- Maintain idempotency through event tracking
- Publish entitlement update events to SNS

**Trigger**: SQS Queue (batch processing)

**Event Types Processed**:
- `subscription.created` → Creates entitlements
- `subscription.updated` → Updates entitlements
- `subscription.canceled` → Revokes at period end or immediately
- `subscription.expired` → Revokes immediately
- `subscription.paused` → Logs pause (entitlements remain active)
- `subscription.resumed` → Re-activates entitlements
- `payment.successful` → Creates entitlements for one-off purchases
- `payment.failed` → Skipped (no action)
- `payment.action_required` → Skipped (no action)

**Data Stores**:
- DynamoDB (`products` table) - Reads product configurations
- DynamoDB (`entitlements` table) - Creates/updates entitlements
- DynamoDB (`processed-events` table) - Tracks processed events for idempotency

**Dependencies**:
- **Product Service**: Reads product configurations and entitlements
- **Access Service**: Uses same `entitlements` table
- **SNS Topic** (`billing-events`): Receives billing events
- **SNS Topic** (`entitlement-updates`): Publishes entitlement change events

---

## Service Communication

### HTTP Communication (Synchronous)

**API Gateway** → **Lambda Services**:
- Product Service, Pricing Service, and Access Service are exposed via a shared API Gateway
- Each service has its own route prefix (`/products`, `/prices`, `/access`)
- All services use API Gateway REST API

### Event-Driven Communication (Asynchronous)

**Billing Events Flow**:
```
External System → SNS Topic (billing-events)
                      ↓
                 SQS Queue (entitlement-queue)
                      ↓
         Entitlement Processor Service (Lambda)
                      ↓
         ┌────────────┴────────────┐
         ↓                          ↓
  Entitlements Table      Entitlement Updates SNS Topic
         ↓                          ↓
  Access Service          Other Services (subscribers)
```

**Event Types**:

1. **Billing Events** (Input to Entitlement Processor):
   - Published to: `billing-events` SNS topic
   - Consumed by: Entitlement Processor Service via SQS
   - Examples: `subscription.created`, `payment.successful`, etc.

2. **Entitlement Update Events** (Output from Entitlement Processor):
   - Published to: `entitlement-updates` SNS topic
   - Consumed by: Other services that need to react to entitlement changes
   - Examples: `entitlement.created`, `entitlement.updated`, `entitlement.revoked`

### Data Dependencies

**Terraform Remote State**:
- Entitlement Processor Service reads outputs from:
  - Product Service: `products_table_name`, `products_table_arn`
  - Access Service: `entitlements_table_name`, `entitlements_table_arn`
- This ensures proper IAM permissions and environment variable configuration

## Data Flow

### Product Creation Flow

```
1. Admin creates product via Product Service API
   POST /products
   ↓
2. Product stored in DynamoDB (products table)
   ↓
3. Admin creates price via Pricing Service API
   POST /prices
   ↓
4. Price stored in DynamoDB (prices table)
```

### Subscription/Payment Flow

```
1. External billing system processes payment/subscription
   ↓
2. Billing system publishes event to SNS (billing-events topic)
   {
     type: "subscription.created",
     payload: { userId, productId, ... },
     meta: { eventId, occurredAt, source }
   }
   ↓
3. SNS forwards to SQS queue (entitlement-queue)
   ↓
4. Entitlement Processor Lambda triggered (batch processing)
   ↓
5. For each event:
   a. Check idempotency (processed-events table)
   b. Read product configuration (products table)
   c. Create/update entitlements (entitlements table)
   d. Process add-ons if applicable
   e. Publish entitlement update events (entitlement-updates SNS topic)
   f. Mark event as processed (processed-events table)
   ↓
6. User queries entitlements via Access Service
   GET /access/entitlements (with JWT)
   ↓
7. Access Service reads from entitlements table
   ↓
8. Returns user's active entitlements
```

### Error Handling

- **SQS Dead Letter Queue**: Failed events (after 3 retries) are sent to DLQ
- **Partial Batch Failures**: Individual event failures don't fail the entire batch
- **Idempotency**: Duplicate events are detected and skipped

## Infrastructure

### AWS Services Used

- **Lambda**: Serverless compute for all services
- **API Gateway**: REST API for HTTP services
- **DynamoDB**: NoSQL database for products, prices, entitlements, and processed events
- **SNS**: Pub/sub messaging for billing events and entitlement updates
- **SQS**: Queue for reliable event processing with DLQ support
- **IAM**: Role-based access control for Lambda functions
- **S3**: Terraform state storage
- **CloudWatch**: Logging and monitoring

### Infrastructure as Code

- **Terraform**: All infrastructure defined in `infra/` directory
- **Modules**: Reusable modules for Lambda, API Gateway integration, IAM roles
- **Remote State**: Services use Terraform remote state to share outputs
- **Environments**: Supports dev, staging, and prod environments

### Deployment

- **CI/CD**: GitHub Actions workflow (`.github/workflows/ci.yml`)
- **Build**: Turborepo for efficient monorepo builds
- **Packaging**: Each service packages into `function.zip` for Lambda deployment
- **Deployment Order**: Services deployed in dependency order
  1. Product Service (no dependencies)
  2. Pricing Service (no dependencies)
  3. Access Service (no dependencies)
  4. Entitlement Processor Service (depends on Product & Access outputs)

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- AWS CLI configured
- Terraform 1.7.0+
- AWS account with appropriate permissions

### Installation

```bash
# Install dependencies
npm install

# Build all services and libraries
npm run build

# Package all services
npm run package
```

### Environment Setup

Each service requires specific environment variables. See individual service READMEs:
- [Product Service README](services/product-service/README.md)
- [Pricing Service README](services/pricing-service/README.md)
- [Access Service README](services/access-service/README.md)
- [Entitlement Service README](services/entitlement-service/README.md)

### Local Development

Services are designed to run in AWS Lambda. For local development:

1. **Set up AWS credentials** (via AWS CLI or environment variables)
2. **Create DynamoDB tables** (or use existing dev tables)
3. **Use AWS SAM or similar** for local Lambda testing
4. **Or use API Gateway local** for HTTP services

### Running Individual Services

```bash
# Build a specific service
cd services/product-service
npm run build

# Package for deployment
npm run package

# Type check
npm run type-check
```

## Development

### Project Structure

```
eislett-education-payment-service/
├── services/              # Deployable microservices
│   ├── product-service/
│   ├── pricing-service/
│   ├── access-service/
│   └── entitlement-service/
├── libs/                  # Shared libraries (not deployed)
│   └── domain/           # Domain models, use cases, repositories
├── infra/                 # Terraform infrastructure
│   ├── modules/          # Reusable Terraform modules
│   └── services/         # Service-specific infrastructure
├── .github/
│   └── workflows/        # CI/CD pipelines
└── docs/                  # Documentation
```

### Architecture Principles

1. **Domain-Driven Design**: Clean architecture with domain, application, and infrastructure layers
2. **Monorepo**: All services in one repository with shared libraries
3. **Event-Driven**: Asynchronous communication via SNS/SQS
4. **Serverless-First**: All services run on AWS Lambda
5. **Infrastructure as Code**: All infrastructure defined in Terraform

### Code Organization

Each service follows this structure:

```
service-name/
├── src/
│   ├── app/              # Application layer
│   │   ├── controllers/ # Request handlers
│   │   └── usecases/    # Business logic
│   ├── handler/         # Lambda handlers
│   └── infrastructure/  # External integrations
├── package.json
├── tsconfig.json
└── README.md
```

### Shared Domain Library

The `libs/domain` package contains:
- **Domain Entities**: Product, Price, Entitlement
- **Use Cases**: Business logic (create entitlement, sync limits, etc.)
- **Repositories**: Data access interfaces and DynamoDB implementations
- **Value Objects**: Type-safe domain concepts (EntitlementKey, ProductType, etc.)
- **Billing Events**: Event types and structures

## Deployment

### CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically:

1. **Builds** affected packages using Turborepo
2. **Packages** services into `function.zip` files
3. **Bootstraps** Terraform backends (S3 buckets, DynamoDB tables)
4. **Deploys** services in dependency order using Terraform

### Manual Deployment

```bash
# Set project name (or use default)
export PROJECT_NAME="${PROJECT_NAME:-eislett-education}"

# Bootstrap Terraform backend (first time only)
cd infra/services/product-service
terraform init \
  -backend-config="bucket=${PROJECT_NAME}-dev-product-service-state" \
  -backend-config="key=tf-infra/dev.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=${PROJECT_NAME}-dev-product-service-state-locking" \
  -backend-config="encrypt=true"

# Deploy service
terraform apply \
  -var="project_name=${PROJECT_NAME}" \
  -var="environment=dev" \
  -var="state_bucket_name=..." \
  -var="state_region=us-east-1" \
  -var="state_bucket_key=..."
```

### Environment Variables

Set via Terraform variables or AWS Systems Manager Parameter Store:
- `PRODUCTS_TABLE` - DynamoDB table name
- `PRICES_TABLE` - DynamoDB table name
- `ENTITLEMENTS_TABLE` - DynamoDB table name
- `PROCESSED_EVENTS_TABLE` - DynamoDB table name
- `JWT_ACCESS_TOKEN_SECRET` - JWT secret (for Access Service)
- `ENTITLEMENT_UPDATES_TOPIC_ARN` - SNS topic ARN (for Entitlement Processor)

## Monitoring & Observability

- **CloudWatch Logs**: All Lambda functions log to CloudWatch
- **CloudWatch Metrics**: Lambda invocations, errors, duration
- **SQS Metrics**: Queue depth, DLQ message count
- **DynamoDB Metrics**: Read/write capacity, throttling

## Security

- **JWT Authentication**: Access Service validates JWT tokens
- **IAM Roles**: Least-privilege IAM roles for each Lambda
- **VPC**: Services can be deployed in VPC if needed
- **Encryption**: Terraform state encrypted at rest
- **Secrets**: Sensitive values stored in AWS Secrets Manager or Parameter Store

## Contributing

1. Create a feature branch
2. Make changes following the architecture patterns
3. Update documentation as needed
4. Ensure all services build and package successfully
5. Submit a pull request

## License

ISC

## Related Documentation

- [Product Creation Guide](docs/PRODUCT_CREATION_GUIDE.md)
- [Project Structure](docs/structure.md)
- [Service READMEs](services/)
