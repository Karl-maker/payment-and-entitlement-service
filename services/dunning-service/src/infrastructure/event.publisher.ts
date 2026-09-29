import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { BillingEvent, entitlementUpdatesSnsMessageAttributes } from "@libs/domain";

type EntitlementRevokedEvent = BillingEvent.EntitlementRevokedEvent;
const EntitlementEventType = BillingEvent.EntitlementEventType;
type BillingEventMetadata = BillingEvent.BillingEventMetadata;

export class EntitlementEventPublisher {
  private readonly topicArn: string;
  private readonly client: SNSClient;

  constructor() {
    const topicArn = process.env.ENTITLEMENT_UPDATES_TOPIC_ARN;
    if (!topicArn) {
      throw new Error("ENTITLEMENT_UPDATES_TOPIC_ARN environment variable is not set");
    }
    this.topicArn = topicArn;
    this.client = new SNSClient({});
  }

  async publish(event: any): Promise<void> {
    try {
      const key =
        typeof event?.payload?.entitlementKey === "string"
          ? event.payload.entitlementKey
          : typeof event?.payload?.key === "string"
            ? event.payload.key
            : "unknown";
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: entitlementUpdatesSnsMessageAttributes(
            event.type || "unknown",
            key,
          ),
        })
      );
      console.log(`Published entitlement event: ${event.type} for user ${event.payload?.userId}`);
    } catch (error) {
      console.error(`Failed to publish entitlement event ${event.type}:`, error);
      // Don't throw - event publishing failure shouldn't fail the main process
    }
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
}
