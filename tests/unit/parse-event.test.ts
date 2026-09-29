import { describe, it, expect } from "@jest/globals";
import {
  parseSqsEvent,
  parseSqsRecord,
} from "../../services/entitlement-service/src/handler/sqs/parse-event";
import billingEvent from "../fixtures/billing-event-subscription-created.json";
import sns from "../fixtures/sns-wrapped-subscription-created.json";
import { sqsRecordWithBody, sqsEventFromBodies } from "../helpers/sqs";

// sqs is direct and then sns is a notification with the actual message in the Message field.
describe("parse-SQS-record", () => {
  it("should parse valid SQS event with SNS message", () => {
    const result = parseSqsRecord(sqsRecordWithBody(billingEvent));
    expect(result.type).toBe("subscription.created");
    expect(result.payload.userId).toBe("user-1");
    expect(result.payload.productId).toBe("prod-1");
    expect(result.meta.eventId).toBe("evt-1");
  });

  it("should parse an SNS notification message", () => {
    const result = parseSqsRecord(sqsRecordWithBody(sns));
    expect(result.type).toBe("subscription.created");
    expect(result.payload.userId).toBe("user-1");
    expect(result.payload.productId).toBe("prod-1");
    expect(result.meta.eventId).toBe("evt-1");
  });

  it("should treat a non-matching SNS shape as a direct event and reject it", () => {
    const record = sqsRecordWithBody({
      type: "Notification",
      Message: JSON.stringify(billingEvent),
    });

    expect(() => parseSqsRecord(record)).toThrow(
      /Invalid billing event structure: missing required fields/,
    );
  });

  it("should throw if an SNS Message is already an object", () => {
    const record = sqsRecordWithBody({
      Type: "Notification",
      Message: billingEvent,
    });

    expect(() => parseSqsRecord(record)).toThrow(
      /Failed to parse SNS message:/,
    );
  });

  // when a field is missing , throw an error
  it("should throw an error if required fields are missing", () => {
    const record = sqsRecordWithBody({
      type: "subscription.created",
      // Missing payload and meta
    });

    expect(() => parseSqsRecord(record)).toThrow(
      "Invalid billing event structure: missing required fields",
    );
  });

  it("should not validate the nested payload schema", () => {
    const record = sqsRecordWithBody({
      type: "subscription.created",
      payload: { unexpectedField: true },
      meta: {
        eventId: "evt-3",
        occurredAt: "2026-04-20T12:01:00.000Z",
        source: "internal",
      },
      version: 1,
    });

    const result = parseSqsRecord(record);
    expect(result.payload).toEqual({ unexpectedField: true });
  });

  it("should parse multiple records in an SQS event", () => {
    // sqs has multiple records
    const event = sqsEventFromBodies([
      billingEvent,
      {
        type: "payment.successful",
        payload: { userId: "user-2", productId: "prod-2" },
        meta: {
          eventId: "evt-2",
          occurredAt: "2026-04-19T12:01:00.000Z",
          source: "internal",
        },
        version: 1,
      },
    ]);

    const results = parseSqsEvent(event);
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("subscription.created");
    expect(results[0].payload.userId).toBe("user-1");
    expect(results[1].type).toBe("payment.successful");
    expect(results[1].payload.userId).toBe("user-2");
  });

  it("should throw an error if the record body is not valid JSON", () => {
    const record = {
      body: "not-valid-json",
    } as any;

    expect(() => parseSqsRecord(record)).toThrow(
      /Failed to parse SQS record body:/,
    );
  });

  it("should throw an error if the SNS message is not valid JSON", () => {
    const record = sqsRecordWithBody({
      Type: "Notification",
      Message: "{ not-valid-json",
    });

    expect(() => parseSqsRecord(record)).toThrow(
      // change it to expect error message contains "Failed to parse SNS message"
      /Failed to parse SNS message:/,
    );
  });

  it("should treat an SNS message without the Message as an invalid event", () => {
    const record = sqsRecordWithBody({
      Type: "Notification",
      // missing Message field
    });

    expect(() => parseSqsRecord(record)).toThrow(
      /Invalid billing event structure: missing required fields/,
    );
  });

  it("should return an empty array if there are no records in the SQS event", () => {
    const event = sqsEventFromBodies([]);
    const result = parseSqsEvent(event);
    expect(result).toEqual([]);
  });
});
