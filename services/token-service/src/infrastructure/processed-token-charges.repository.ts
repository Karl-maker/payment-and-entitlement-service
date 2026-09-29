import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const IDEMPOTENCY_KEY_PREFIX = "TOKEN_CHARGE#";
const RATE_LIMIT_KEY_PREFIX = "TOKEN_RATE#";
const TTL_DAYS = 90;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export interface ProcessedTokenChargesRepository {
  getCachedResponse<T = unknown>(idempotencyKey: string): Promise<T | null>;
  saveCachedResponse(idempotencyKey: string, response: unknown): Promise<void>;
  canCharge(userId: string): Promise<boolean>;
  recordCharge(userId: string): Promise<void>;
}

export class DynamoProcessedTokenChargesRepository implements ProcessedTokenChargesRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  // we cache response so duplicated requests with same idempotency key can return same response without re-processing the charge logic
  async getCachedResponse<T = unknown>(
    idempotencyKey: string,
  ): Promise<T | null> {
    const eventId = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { eventId },
      }),
    );

    return (result.Item?.response as T | undefined) ?? null;
  }

  async saveCachedResponse(
    idempotencyKey: string,
    response: unknown,
  ): Promise<void> {
    const eventId = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          eventId,
          ttl,
          processedAt: new Date().toISOString(),
          response,
        },
      }),
    );
  }

  async canCharge(userId: string): Promise<boolean> {
    const eventId = `${RATE_LIMIT_KEY_PREFIX}${userId}`;
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { eventId },
      }),
    );

    if (!result.Item?.lastChargedAt) {
      return true;
    }

    const lastChargedAt = new Date(result.Item.lastChargedAt).getTime();
    return Date.now() - lastChargedAt >= RATE_LIMIT_WINDOW_MS;
  }

  async recordCharge(userId: string): Promise<void> {
    const eventId = `${RATE_LIMIT_KEY_PREFIX}${userId}`;
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          eventId,
          ttl,
          lastChargedAt: new Date().toISOString(),
        },
      }),
    );
  }
}
