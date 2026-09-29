import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { BillingEvent, entitlementUpdatesSnsMessageAttributes } from "@libs/domain";
import type { Entitlement } from "@libs/domain";

type EntitlementCreatedEvent = BillingEvent.EntitlementCreatedEvent;
type EntitlementUpdatedEvent = BillingEvent.EntitlementUpdatedEvent;
type EntitlementRevokedEvent = BillingEvent.EntitlementRevokedEvent;
type EntitlementAvailabilityUpdatedEvent = BillingEvent.EntitlementAvailabilityUpdatedEvent;
const EntitlementEventType = BillingEvent.EntitlementEventType;
type BillingEventMetadata = BillingEvent.BillingEventMetadata;

export class EntitlementEventPublisher {
  private readonly topicArn: string;
  private readonly client: SNSClient;

  constructor(topicArn?: string) {
    const resolved = topicArn ?? process.env.ENTITLEMENT_UPDATES_TOPIC_ARN;
    if (!resolved) {
      throw new Error("ENTITLEMENT_UPDATES_TOPIC_ARN environment variable is not set");
    }
    this.topicArn = resolved;
    this.client = new SNSClient({});
  }

  async publishCreated(payload: EntitlementCreatedEvent["payload"], metadata: BillingEventMetadata): Promise<void> {
    const event: EntitlementCreatedEvent = {
      type: EntitlementEventType.ENTITLEMENT_CREATED,
      payload,
      meta: metadata,
      version: 1
    };

    await this.publish(event);
  }

  async publishUpdated(payload: EntitlementUpdatedEvent["payload"], metadata: BillingEventMetadata): Promise<void> {
    const event: EntitlementUpdatedEvent = {
      type: EntitlementEventType.ENTITLEMENT_UPDATED,
      payload,
      meta: metadata,
      version: 1
    };

    await this.publish(event);
  }

  async publishRevoked(payload: EntitlementRevokedEvent["payload"], metadata: BillingEventMetadata): Promise<void> {
    const event: EntitlementRevokedEvent = {
      type: EntitlementEventType.ENTITLEMENT_REVOKED,
      payload,
      meta: metadata,
      version: 1
    };

    await this.publish(event);
  }

  /**
   * Publish when entitlement availability changes (usage increased, decreased, reset, or limit changed).
   * Payload: key, userId, currentAvailableUsage (remaining = limit - used, or null if not usage-based).
   */
  async publishAvailabilityUpdated(
    userId: string,
    key: string,
    currentAvailableUsage: number | null
  ): Promise<void> {
    const event: EntitlementAvailabilityUpdatedEvent = {
      type: EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED,
      payload: { userId, key, currentAvailableUsage },
      meta: {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        source: "internal",
      },
      version: 1,
    };
    await this.publishGeneric(event);
  }

  /** Publish availability from an entitlement entity (computes currentAvailableUsage from usage). */
  async publishAvailabilityFromEntitlement(entitlement: Entitlement): Promise<void> {
    const currentAvailableUsage = entitlement.usage
      ? entitlement.usage.getEffectiveLimit() - entitlement.usage.used
      : null;
    await this.publishAvailabilityUpdated(entitlement.userId, entitlement.key, currentAvailableUsage);
  }

  private async publishGeneric(event: EntitlementAvailabilityUpdatedEvent): Promise<void> {
    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: entitlementUpdatesSnsMessageAttributes(
            event.type,
            event.payload.key,
          ),
        })
      );
      console.log(
        `Published entitlement event: ${event.type} for user ${event.payload.userId} key=${event.payload.key} currentAvailableUsage=${event.payload.currentAvailableUsage}`
      );
    } catch (error) {
      console.error(`Failed to publish entitlement event ${event.type}:`, error);
      // Don't throw - event publishing failure shouldn't fail the main process
    }
  }

  private async publish(event: EntitlementCreatedEvent | EntitlementUpdatedEvent | EntitlementRevokedEvent): Promise<void> {
    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: entitlementUpdatesSnsMessageAttributes(
            event.type,
            event.payload.entitlementKey,
          ),
        })
      );
      console.log(`Published entitlement event: ${event.type} for user ${event.payload.userId}`);
    } catch (error) {
      console.error(`Failed to publish entitlement event ${event.type}:`, error);
      // Don't throw - event publishing failure shouldn't fail the main process
    }
  }
}
