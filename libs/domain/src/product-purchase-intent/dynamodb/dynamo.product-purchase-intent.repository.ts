import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ProductPurchaseIntentRepository } from "../app/ports/product-purchase-intent.repository";
import { ProductPurchaseIntent } from "../domain/entities/product-purchase-intent.entity";
import type { ProductPurchaseIntentItem } from "../domain/entities/product-purchase-intent-item.entity";

export class DynamoProductPurchaseIntentRepository implements ProductPurchaseIntentRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(tableName?: string, client?: DynamoDBDocumentClient) {
    this.tableName =
      tableName ??
      (() => {
        const env = process.env.PRODUCT_PURCHASE_INTENT_TABLE;
        if (!env) throw new Error("PRODUCT_PURCHASE_INTENT_TABLE environment variable is not set");
        return env;
      })();
    this.client =
      client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  async findById(id: string): Promise<ProductPurchaseIntent | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      })
    );
    if (!result.Item) return null;
    return this.toDomain(result.Item);
  }

  async findByUserId(userId: string, limit = 100): Promise<ProductPurchaseIntent[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );
    return (result.Items ?? []).map((item) => this.toDomain(item));
  }

  async save(intent: ProductPurchaseIntent): Promise<void> {
    const item = this.toItem(intent);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  private toItem(intent: ProductPurchaseIntent): Record<string, unknown> {
    return {
      id: intent.id,
      userId: intent.userId,
      GSI1PK: `USER#${intent.userId}`,
      GSI1SK: intent.createdAt.toISOString(),
      items: intent.items,
      subtotal: intent.subtotal,
      tax: intent.tax,
      discount: intent.discount,
      total: intent.total,
      currency: intent.currency,
      status: intent.status,
      expiresAt: intent.expiresAt.toISOString(),
      createdAt: intent.createdAt.toISOString(),
    };
  }

  private toDomain(item: Record<string, unknown>): ProductPurchaseIntent {
    const rawItems = (item.items as unknown[]) ?? [];
    const items: ProductPurchaseIntentItem[] = rawItems.map((i) => ({
      productId: (i as Record<string, unknown>).productId as string,
      name: (i as Record<string, unknown>).name as string,
      unitPrice: (i as Record<string, unknown>).unitPrice as number,
      quantity: (i as Record<string, unknown>).quantity as number,
      total: (i as Record<string, unknown>).total as number,
    }));
    return new ProductPurchaseIntent(
      item.id as string,
      item.userId as string,
      items,
      (item.subtotal as number) ?? 0,
      (item.tax as number) ?? 0,
      (item.discount as number) ?? 0,
      (item.total as number) ?? 0,
      (item.currency as string) ?? "USD",
      item.status as ProductPurchaseIntent["status"],
      new Date(item.expiresAt as string),
      new Date(item.createdAt as string)
    );
  }
}
