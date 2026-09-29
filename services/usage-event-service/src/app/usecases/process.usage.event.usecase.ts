import {
  EntitlementRepository,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { UsageDomainEvent } from "@libs/domain";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export class ProcessUsageEventUseCase {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    private readonly entitlementRepo: EntitlementRepository,
    private readonly usageLogsTableName: string,
    private readonly entitlementUpdateNotifier?: EntitlementUpdateNotifier,
  ) {
    this.docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async execute(event: UsageDomainEvent): Promise<void> {
    const { userId, entitlementKey, amount } = event;

    const entitlement = await this.entitlementRepo.findByUserAndKey(
      userId,
      entitlementKey,
    );

    if (!entitlement) {
      throw new Error(
        `Entitlement '${entitlementKey}' not found for user '${userId}'`,
      );
    }

    if (!entitlement.isActive()) {
      throw new Error(
        `Entitlement '${entitlementKey}' is not active for user '${userId}'`,
      );
    }

    if (!entitlement.usage) {
      throw new Error(
        `Entitlement '${entitlementKey}' has no usage tracking for user '${userId}'`,
      );
    }

    // Lazy evaluation: reset usage if reset period has passed
    if (entitlement.usage.shouldReset()) {
      entitlement.usage.reset();
      await this.entitlementRepo.update(entitlement);
      await this.entitlementUpdateNotifier?.notify(entitlement);
    }

    const previousUsed = entitlement.usage.used;

    entitlement.usage.consume(amount);
    await this.entitlementRepo.update(entitlement);

    const createdAt = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

    await this.docClient.send(
      new PutCommand({
        TableName: this.usageLogsTableName,
        Item: {
          PK: `USER#${userId}`,
          SK: `USAGE#${createdAt}#${entitlementKey}`,
          userId,
          entitlementKey,
          delta: amount,
          previousUsed,
          newUsed: entitlement.usage.used,
          createdAt,
          ttl,
        },
      }),
    );

    await this.entitlementUpdateNotifier?.notify(entitlement);

    console.log(
      `Recorded usage: ${amount} for ${entitlementKey} (user: ${userId}), used: ${entitlement.usage.used}/${entitlement.usage.getEffectiveLimit()}`,
    );
  }
}
