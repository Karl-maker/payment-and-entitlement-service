import { BillingEvent } from "@libs/domain";

export interface PowerTranzEmailJob {
  template: "payment-successful.hbs" | "payment-failed.hbs";
  header: string;
  to: string;
  content: Record<string, unknown>;
}

export interface PowerTranzEmailQueue {
  send(job: PowerTranzEmailJob): Promise<void>;
}

export interface PowerTranzBillingEventPublisher {
  publish(
    event:
      | BillingEvent.PaymentSuccessfulEvent
      | BillingEvent.PaymentFailedEvent,
  ): Promise<void>;
}
