import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  PowerTranzIntentRepository,
  PowerTranzPaymentIntent,
} from "./powertranz.intent.repository";

export class DynamoPowerTranzIntentRepository implements PowerTranzIntentRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName = process.env.POWERTRANZ_INTENTS_TABLE_NAME || "") {
    if (!tableName) {
      throw new Error(
        "POWERTRANZ_INTENTS_TABLE_NAME environment variable is required",
      );
    }

    this.tableName = tableName;
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async save(intent: PowerTranzPaymentIntent): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: intent,
      }),
    );
  }

  async findBySpiToken(
    spiToken: string,
  ): Promise<PowerTranzPaymentIntent | null> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { spiToken },
      }),
    );
    return (res.Item as PowerTranzPaymentIntent) || null;
  }

  async findByUserId(
    userId: string,
    limit?: number,
  ): Promise<PowerTranzPaymentIntent[]> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
      }),
    );

    const items = ((result.Items as PowerTranzPaymentIntent[] | undefined) ?? [])
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

    return typeof limit === "number" ? items.slice(0, limit) : items;
  }

  async updateBySpiToken(
    spiToken: string,
    patch: Partial<PowerTranzPaymentIntent>,
  ): Promise<void> {
    const entries = Object.entries(patch).filter(
      ([, value]) => value !== undefined,
    );

    if (entries.length === 0) {
      return;
    }

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];

    entries.forEach(([key, value], index) => {
      const nameKey = `#k${index}`;
      const valueKey = `:v${index}`;
      names[nameKey] = key;
      values[valueKey] = value;
      sets.push(`${nameKey} = ${valueKey}`);
    });

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { spiToken },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }
}
