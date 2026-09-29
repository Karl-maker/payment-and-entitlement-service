import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { BillingEvent } from "@libs/domain";

type BillingDomainEvent<T = unknown> = BillingEvent.BillingDomainEvent<T>;

export class BillingEventPublisher {
  private readonly client: SNSClient;
  private readonly topicArn: string;

  constructor(topicArn = process.env.BILLING_EVENTS_TOPIC_ARN || "") {
    if (!topicArn) {
      throw new Error("BILLING_EVENTS_TOPIC_ARN is not configured");
    }

    this.topicArn = topicArn;
    this.client = new SNSClient({});
  }

  async publish(event: BillingDomainEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: "String",
            StringValue: event.type,
          },
        },
      }),
    );
  }
}
