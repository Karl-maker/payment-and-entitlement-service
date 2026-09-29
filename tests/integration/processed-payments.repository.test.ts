import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  docClient,
  TABLE_NAMES,
} from "../helpers/localstack";
import { DynamoProcessedPaymentsRepository } from "../../services/entitlement-service/src/infrastructure/processed-payments.repository";

describe("DynamoProcessedPaymentsRepository (LocalStack)", () => {
  let repo: DynamoProcessedPaymentsRepository;

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    repo = new DynamoProcessedPaymentsRepository(
      TABLE_NAMES.processedEvents,
      docClient(),
    );
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.processedEvents, ["eventId"]);
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  it("returns false before a payment is inserted", async () => {
    const result = await repo.isPaymentProcessed("pi-test-1");

    expect(result).toBe(false);
  });

  it("returns true after the same payment is inserted", async () => {
    const paymentIntentId = "pi-test-2";

    await repo.markPaymentProcessed(paymentIntentId);
    const result = await repo.isPaymentProcessed(paymentIntentId);

    expect(result).toBe(true);
  });

  it("does not treat a different paymentIntentId as processed", async () => {
    await repo.markPaymentProcessed("pi-test-a");

    const result = await repo.isPaymentProcessed("pi-test-b");

    expect(result).toBe(false);
  });

  it("stores the PAYMENT# key in DynamoDB", async () => {
    const paymentIntentId = "pi-int-002";

    await repo.markPaymentProcessed(paymentIntentId);

    const result = await docClient().send(
      new GetCommand({
        TableName: TABLE_NAMES.processedEvents,
        Key: {
          eventId: `PAYMENT#${paymentIntentId}`,
        },
      }),
    );

    expect(result.Item?.eventId).toBe(`PAYMENT#${paymentIntentId}`);
  });

  it("stores ttl and processedAt", async () => {
    const paymentIntentId = "pi-int-002";

    await repo.markPaymentProcessed(paymentIntentId);

    const result = await docClient().send(
      new GetCommand({
        TableName: TABLE_NAMES.processedEvents,
        Key: {
          eventId: `PAYMENT#${paymentIntentId}`,
        },
      }),
    );

    expect(typeof result.Item?.ttl).toBe("number");
    expect(typeof result.Item?.processedAt).toBe("string");
  });

  it("can mark the same payment twice and still read it as processed", async () => {
    const paymentIntentId = "pi-test-5";

    await repo.markPaymentProcessed(paymentIntentId);
    await repo.markPaymentProcessed(paymentIntentId);

    const result = await repo.isPaymentProcessed(paymentIntentId);

    expect(result).toBe(true);
  });
});
