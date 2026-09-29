import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  FindTransactionsOptions,
  PaginatedTransactionsResult,
  TransactionRepository,
} from "../app/ports/transaction.repository";
import { Transaction, TransactionProvider } from "../domain/entities/transaction.entity";

interface TransactionsCursorPayload {
  userId: string;
  provider?: TransactionProvider;
  createdAt: string;
  transactionId: string;
}

export class DynamoTransactionRepository implements TransactionRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
    const dynamoClient = new DynamoDBClient({});
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  async save(transaction: Transaction): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.toDynamo(transaction),
      })
    );
  }

  async findByUserId(userId: string, options: FindTransactionsOptions = {}): Promise<PaginatedTransactionsResult> {
    const { limit = 100, provider, cursor } = options;
    const items: Record<string, any>[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      items.push(...(result.Items ?? []));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const normalizedProvider = normalizeProvider(provider);

    const sortedTransactions = items
      .map(item => this.toDomain(item))
      .filter(transaction => !normalizedProvider || transaction.provider === normalizedProvider)
      .sort(compareTransactionsDescending);

    const startIndex = cursor
      ? this.findCursorStartIndex(sortedTransactions, cursor, userId, normalizedProvider)
      : 0;

    const pageItems = sortedTransactions.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < sortedTransactions.length;
    const nextCursor = hasMore && pageItems.length > 0
      ? encodeCursor({
          userId,
          provider: normalizedProvider,
          createdAt: pageItems[pageItems.length - 1].createdAt.toISOString(),
          transactionId: pageItems[pageItems.length - 1].transactionId,
        })
      : undefined;

    return {
      items: pageItems,
      hasMore,
      nextCursor,
    };
  }

  async findAll(limit = 100): Promise<Transaction[]> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: limit,
      })
    );

    // Sort by createdAt descending (most recent first)
    const transactions = (result.Items ?? []).map(this.toDomain);
    return transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  async findById(transactionId: string): Promise<Transaction | null> {
    // Note: This requires a GSI or knowing the userId
    // For now, we'll need to scan or use a different approach
    // This is a limitation - in production, you might want a GSI on transactionId
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "transactionId = :tid",
        ExpressionAttributeValues: {
          ":tid": transactionId,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return this.toDomain(result.Items[0]);
  }

  private toDynamo(transaction: Transaction): Record<string, any> {
    return {
      PK: `USER#${transaction.userId}`,
      SK: `TRANSACTION#${transaction.transactionId}#${transaction.createdAt.toISOString()}`,
      transactionId: transaction.transactionId,
      userId: transaction.userId,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      productId: transaction.productId,
      priceId: transaction.priceId,
      subscriptionId: transaction.subscriptionId,
      provider: transaction.provider,
      createdAt: transaction.createdAt.toISOString(),
      metadata: transaction.metadata ? JSON.stringify(transaction.metadata) : undefined,
    };
  }

  private toDomain(item: Record<string, any>): Transaction {
    const metadata = parseMetadata(item.metadata);
    const provider = normalizeProvider(item.provider ?? metadata?.provider);

    return new Transaction(
      item.transactionId,
      item.userId,
      item.type,
      item.status,
      item.amount,
      item.currency,
      new Date(item.createdAt),
      item.productId,
      item.priceId,
      item.subscriptionId,
      provider,
      metadata
    );
  }

  private findCursorStartIndex(
    transactions: Transaction[],
    cursor: string,
    userId: string,
    provider?: TransactionProvider,
  ): number {
    const decoded = decodeCursor(cursor);

    if (decoded.userId !== userId || decoded.provider !== provider) {
      throw validationError("Cursor does not match the current transaction query");
    }

    const itemIndex = transactions.findIndex(transaction =>
      transaction.transactionId === decoded.transactionId &&
      transaction.createdAt.toISOString() === decoded.createdAt
    );

    if (itemIndex === -1) {
      throw validationError("Cursor is invalid or no longer available for this query");
    }

    return itemIndex + 1;
  }
}

function parseMetadata(metadata: unknown): Record<string, any> | undefined {
  if (!metadata) {
    return undefined;
  }

  if (typeof metadata === "string") {
    return JSON.parse(metadata) as Record<string, any>;
  }

  if (typeof metadata === "object") {
    return metadata as Record<string, any>;
  }

  return undefined;
}

function normalizeProvider(provider: unknown): TransactionProvider | undefined {
  if (typeof provider !== "string") {
    return undefined;
  }

  const normalized = provider.trim().toLowerCase();
  if (normalized === "stripe" || normalized === "powertranz") {
    return normalized;
  }

  return undefined;
}

function compareTransactionsDescending(a: Transaction, b: Transaction): number {
  const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return b.transactionId.localeCompare(a.transactionId);
}

function encodeCursor(payload: TransactionsCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodeCursor(cursor: string): TransactionsCursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as Partial<TransactionsCursorPayload>;
    const provider = normalizeProvider(parsed.provider);

    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.transactionId !== "string"
    ) {
      throw new Error("Missing cursor fields");
    }

    return {
      userId: parsed.userId,
      provider,
      createdAt: parsed.createdAt,
      transactionId: parsed.transactionId,
    };
  } catch {
    throw validationError("Cursor is malformed");
  }
}

function validationError(message: string): Error {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}
