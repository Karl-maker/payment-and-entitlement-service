import type { SQSEvent, SQSRecord } from "aws-lambda";

function makeSqsRecord(body: unknown, index: number): SQSRecord {
  return {
    messageId: `msg-${index + 1}`,
    receiptHandle: `rh-${index + 1}`,
    body: JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "1",
      SenderId: "sender",
      ApproximateFirstReceiveTimestamp: "1",
    },
    messageAttributes: {},
    md5OfBody: `md5-msg-${index + 1}`,
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:queue",
    awsRegion: "us-east-1",
  };
}

export function sqsRecordWithBody(body: unknown): SQSRecord {
  return makeSqsRecord(body, 0);
}

export function sqsEventFromBodies(bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => makeSqsRecord(body, index)),
  };
}

export function sqsEventFromRecords(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

export function sqsEventFromFixture(fixture: unknown): SQSEvent {
  return fixture as SQSEvent;
}
