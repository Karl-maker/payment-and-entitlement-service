import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { BillingEvent, entitlementUpdatesSnsMessageAttributes } from "@libs/domain";

const EntitlementEventType = BillingEvent.EntitlementEventType;

/**
 * Publishes entitlement.availability_updated to SNS when usage/limit changes.
 * No-op if ENTITLEMENT_UPDATES_TOPIC_ARN is not set.
 */
export class EntitlementUpdatesPublisher {
  private readonly topicArn: string | null;
  private readonly client: SNSClient;

  constructor(topicArn?: string) {
    this.topicArn = topicArn ?? process.env.ENTITLEMENT_UPDATES_TOPIC_ARN ?? null;
    this.client = new SNSClient({});
  }

  async publishAvailabilityUpdated(
    userId: string,
    key: string,
    currentAvailableUsage: number | null
  ): Promise<void> {
    if (!this.topicArn) return;
    const event = {
      type: EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED,
      payload: { userId, key, currentAvailableUsage },
      meta: { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), source: "internal" as const },
      version: 1,
    };
    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: entitlementUpdatesSnsMessageAttributes(
            event.type,
            key,
          ),
        })
      );
    } catch (err) {
      console.error("Failed to publish entitlement availability update:", err);
    }
  }
}
