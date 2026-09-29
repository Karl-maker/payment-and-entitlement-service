import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  PowerTranzEmailJob,
  PowerTranzEmailQueue,
} from "./powertranz.callback.effects";

export class SqsEmailQueuePublisher implements PowerTranzEmailQueue {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(queueUrl = process.env.EMAIL_QUEUE_URL || "") {
    if (!queueUrl) {
      throw new Error("EMAIL_QUEUE_URL is not configured");
    }

    this.queueUrl = queueUrl;
    this.client = new SQSClient({});
  }

  async send(job: PowerTranzEmailJob): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  }
}
