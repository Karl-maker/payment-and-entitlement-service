import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
  type KeySchemaElement,
  type AttributeDefinition,
  type GlobalSecondaryIndex,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const REGION = "us-east-1";

function clientConfig() {
  return {
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  };
}

export function dynamoClient() {
  return new DynamoDBClient(clientConfig());
}

export function docClient() {
  return DynamoDBDocumentClient.from(dynamoClient(), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function snsClient() {
  return new SNSClient(clientConfig());
}

export function sqsClient() {
  return new SQSClient(clientConfig());
}

interface TableDef {
  TableName: string;
  KeySchema: KeySchemaElement[];
  AttributeDefinitions: AttributeDefinition[];
  GlobalSecondaryIndexes?: GlobalSecondaryIndex[];
}

const PAYMENT_TABLES: TableDef[] = [
  {
    TableName: "products-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "GSI1",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
  {
    TableName: "prices-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "GSI1",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
  {
    TableName: "entitlements-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
  },
  {
    TableName: "dunning-test",
    KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
  },
  {
    TableName: "transactions-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
  },
  {
    TableName: "trials-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
  },
  {
    /** Matches aws_dynamodb_table.processed_events (hash_key = eventId) for idempotency keys. */
    TableName: "processed-events-test",
    KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "eventId", AttributeType: "S" }],
  },
  {
    TableName: "product-purchase-intent-test",
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "GSI1",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
  {
    TableName: "usage-logs-test",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
  },
];

export async function createAllTables(): Promise<void> {
  const ddb = dynamoClient();
  const existing = await ddb.send(new ListTablesCommand({}));
  const existingNames = new Set(existing.TableNames ?? []);

  for (const def of PAYMENT_TABLES) {
    if (existingNames.has(def.TableName)) continue;

    await ddb.send(
      new CreateTableCommand({
        ...def,
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
  }
}

export async function deleteAllTables(): Promise<void> {
  const ddb = dynamoClient();
  for (const def of PAYMENT_TABLES) {
    try {
      await ddb.send(new DeleteTableCommand({ TableName: def.TableName }));
    } catch {
      // table may not exist
    }
  }
}

export async function clearTable(
  tableName: string,
  keys: string[] = ["PK", "SK"],
): Promise<void> {
  const ddb = DynamoDBDocumentClient.from(dynamoClient());
  const projection = keys.join(", ");
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scan = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: projection,
        ExclusiveStartKey: lastKey,
      }),
    );

    if (scan.Items?.length) {
      await Promise.all(
        scan.Items.map((item) => {
          const key: Record<string, unknown> = {};
          for (const k of keys) {
            key[k] = item[k];
          }
          return ddb.send(
            new DeleteCommand({ TableName: tableName, Key: key }),
          );
        }),
      );
    }

    lastKey = scan.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
}

export async function createSnsTopic(name: string): Promise<string> {
  const sns = snsClient();
  const result = await sns.send(new CreateTopicCommand({ Name: name }));
  return result.TopicArn!;
}

/**
 * Create an SQS queue and subscribe it to an SNS topic (for e2e tests).
 * Returns the queue URL.
 */
export async function createQueueSubscribedToSns(
  queueName: string,
  topicArn: string,
): Promise<string> {
  const sqs = sqsClient();
  const createResult = await sqs.send(
    new CreateQueueCommand({ QueueName: queueName }),
  );
  const queueUrl = createResult.QueueUrl!;

  const attrs = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["QueueArn"],
    }),
  );
  const queueArn = attrs.Attributes?.QueueArn;
  if (!queueArn) throw new Error("Failed to get queue ARN");

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "sns.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: queueArn,
        Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
      },
    ],
  };
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: { Policy: JSON.stringify(policy) },
    }),
  );

  const sns = snsClient();
  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: queueArn,
    }),
  );

  return queueUrl;
}

/** Poll the queue for one message (SNS-wrapped), unwrap and return body; null if none within timeoutMs. */
export async function receiveOneMessageFromQueue<T = unknown>(
  queueUrl: string,
  timeoutMs: number = 15000,
): Promise<{ body: T } | null> {
  const sqs = sqsClient();
  const deadline = Date.now() + timeoutMs;
  const waitSeconds = 5;

  while (Date.now() < deadline) {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: Math.min(waitSeconds, 20),
        VisibilityTimeout: 30,
      }),
    );

    const messages = result.Messages ?? [];
    if (messages.length === 0) continue;

    const msg = messages[0];
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: msg.ReceiptHandle!,
      }),
    );

    let body: T;
    try {
      const raw = JSON.parse(msg.Body ?? "{}");
      if (raw.Type === "Notification" && raw.Message != null) {
        body = JSON.parse(raw.Message) as T;
      } else {
        body = raw as T;
      }
    } catch {
      body = msg.Body as unknown as T;
    }
    return { body };
  }
  return null;
}

/** Remove all messages from a queue (for isolated / idempotent integration tests). */
export async function purgeQueue(queueUrl: string): Promise<void> {
  const sqs = sqsClient();
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}

/**
 * Receive and delete every message currently in the queue (short poll per message).
 * Stops when the queue is empty for one poll cycle.
 */
export async function drainAllMessagesFromQueue(
  queueUrl: string,
  maxMessages = 50,
): Promise<unknown[]> {
  const bodies: unknown[] = [];
  for (let i = 0; i < maxMessages; i++) {
    const m = await receiveOneMessageFromQueue<unknown>(queueUrl, 2500);
    if (!m) break;
    bodies.push(m.body);
  }
  return bodies;
}

export function setTestEnvVars(
  overrides: {
    billingEventsTopicArn?: string;
  } = {},
): void {
  process.env.PRODUCTS_TABLE = "products-test";
  process.env.PRICES_TABLE = "prices-test";
  process.env.ENTITLEMENTS_TABLE = "entitlements-test";
  process.env.DUNNING_TABLE = "dunning-test";
  process.env.TRANSACTIONS_TABLE = "transactions-test";
  process.env.TRIALS_TABLE = "trials-test";
  process.env.PROCESSED_EVENTS_TABLE = "processed-events-test";
  process.env.PRODUCT_PURCHASE_INTENT_TABLE = "product-purchase-intent-test";
  process.env.BILLING_EVENTS_TOPIC_ARN =
    overrides.billingEventsTopicArn ??
    "arn:aws:sns:us-east-1:000000000000:billing-events-test";
  process.env.ENVIRONMENT = "test";
  process.env.AWS_REGION = "us-east-1";
  process.env.NODE_ENV = "test";
  process.env.USAGE_LOGS_TABLE = "usage-logs-test";
}

export const TABLE_NAMES = {
  products: "products-test",
  prices: "prices-test",
  entitlements: "entitlements-test",
  dunning: "dunning-test",
  transactions: "transactions-test",
  trials: "trials-test",
  processedEvents: "processed-events-test",
  productPurchaseIntent: "product-purchase-intent-test",
  usageLogs: "usage-logs-test",
};
