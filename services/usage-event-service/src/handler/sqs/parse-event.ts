import { SQSEvent, SQSRecord } from "aws-lambda";
import { UsageDomainEvent, UsageEventPayload } from "@libs/domain";

export function parseSqsEvent(event: SQSEvent): UsageDomainEvent[] {
  return event.Records.map((record) => parseSqsRecord(record));
}

export function parseSqsRecord(record: SQSRecord): UsageDomainEvent {
  let body: unknown;

  try {
    body = JSON.parse(record.body);
  } catch (error) {
    throw new Error(
      `Failed to parse SQS record body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const payload = body as UsageEventPayload;

  if (!payload.userId || !payload.entitlementKey) {
    throw new Error(
      "Invalid usage event: missing required fields (userId, entitlementKey)",
    );
  }

  const amount = typeof payload.amount === "number" ? payload.amount : 1;

  return {
    userId: payload.userId,
    entitlementKey: payload.entitlementKey,
    amount,
    idempotencyKey: payload.idempotencyKey,
    metadata: payload.metadata,
  };
}
