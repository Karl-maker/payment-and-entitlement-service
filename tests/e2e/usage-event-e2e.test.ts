import { jest } from "@jest/globals";
import {
  DynamoEntitlementRepository,
  Entitlement,
  EntitlementKey,
  EntitlementStatus,
  EntitlementUsage,
} from "@libs/domain";
import { handler } from "../../services/usage-event-service/src/handler";
import {
  createAllTables,
  clearTable,
  deleteAllTables,
  createQueueSubscribedToSns,
  createSnsTopic,
  docClient,
  drainAllMessagesFromQueue,
  receiveOneMessageFromQueue,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { sqsEventFromBodies } from "../helpers/sqs";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

function makeUsageLogTtl() {
  return Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
}

describe("Usage Event E2E Test", () => {
  let entitlementRepository: DynamoEntitlementRepository;
  let entitlementUpdatesQueueUrl: string;

  const userId = `user-${Date.now()}`;
  const entitlementKey = EntitlementKey.QUESTION_GENERATION;

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();

    const entitlementUpdatesTopicArn = await createSnsTopic(
      "usage-event-entitlement-updates-test",
    );
    entitlementUpdatesQueueUrl = await createQueueSubscribedToSns(
      "usage-event-entitlement-updates-test-queue",
      entitlementUpdatesTopicArn,
    );
    process.env.ENTITLEMENT_UPDATES_TOPIC_ARN = entitlementUpdatesTopicArn;

    entitlementRepository = new DynamoEntitlementRepository(
      TABLE_NAMES.entitlements,
      docClient(),
    );
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.entitlements);
    await drainAllMessagesFromQueue(entitlementUpdatesQueueUrl, 500);
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  async function createEntitlement(params: {
    userId: string;
    used?: number;
    limit?: number;
    expiresAt?: Date;
  }) {
    const entitlement: Entitlement = new Entitlement(
      params.userId,
      entitlementKey,
      "learner",
      EntitlementStatus.ACTIVE,
      new Date(),
      params.expiresAt,
      new EntitlementUsage(params.limit ?? 100, params.used ?? 0),
    );

    await entitlementRepository.save(entitlement);
    return entitlement;
  }

  it("publishes usage events", async () => {
    await createEntitlement({ userId, used: 10, limit: 100 });

    await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 5,
        },
      ]),
    );

    const message = await receiveOneMessageFromQueue<any>(
      entitlementUpdatesQueueUrl,
      15000,
    );

    expect(message?.body).toMatchObject({
      type: "entitlement.availability_updated",
      payload: {
        userId,
        key: entitlementKey,
        currentAvailableUsage: 85,
      },
      meta: {
        source: "internal",
      },
      version: 1,
    });
  });

  it("updates usaged and publishes entitlement availability ", async () => {
    await createEntitlement({ userId, used: 10, limit: 100 });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 5,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);

    const entitlement = await entitlementRepository.findByUserAndKey(
      userId,
      entitlementKey,
    );
    expect(entitlement?.usage?.used).toBe(15);

    const message = await receiveOneMessageFromQueue<any>(
      entitlementUpdatesQueueUrl,
      15000,
    );

    expect(message).not.toBeNull();
    expect(message?.body).toMatchObject({
      type: "entitlement.availability_updated",
      payload: {
        userId,
        key: entitlementKey,
        currentAvailableUsage: 85,
      },
      version: 1,
    });
  });

  it("defaults amount to 1 when amount is omitted", async () => {
    await createEntitlement({ userId, used: 0, limit: 100 });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);

    const entitlement = await entitlementRepository.findByUserAndKey(
      userId,
      entitlementKey,
    );

    expect(entitlement?.usage?.used).toBe(1);
  });

  it("decrements usage when a negative amount is sent", async () => {
    await createEntitlement({ userId, used: 20, limit: 100 });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: -5,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([]);

    const entitlement = await entitlementRepository.findByUserAndKey(
      userId,
      entitlementKey,
    );

    expect(entitlement?.usage?.used).toBe(15);
  });

  it("does not allow usage to exceed the limit", async () => {
    await createEntitlement({ userId, used: 3, limit: 6 });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 4,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);

    const entitlement = await entitlementRepository.findByUserAndKey(
      userId,
      entitlementKey,
    );

    expect(entitlement?.usage?.used).toBe(3);
  });

  it("rejects usage when entitlement has no usage tracking", async () => {
    await entitlementRepository.save(
      new Entitlement(
        userId,
        entitlementKey,
        "learner",
        EntitlementStatus.ACTIVE,
        new Date(),
        undefined,
        undefined,
      ),
    );

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 1,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
  });

  it("rejects usage when entitlement is expired", async () => {
    await createEntitlement({
      userId,
      used: 0,
      limit: 100,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 1,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
  });

  it("processes a mixed batch and returns only failed record IDs", async () => {
    await createEntitlement({ userId, used: 0, limit: 100 });

    const result = await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 1,
        },
        {
          userId,
          entitlementKey: "missing-entitlement",
          amount: 1,
        },
      ]),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-2" }]);
  });

  it("stores a usage log record with a 90-day TTL", async () => {
    await createEntitlement({ userId, used: 10, limit: 100 });

    await handler(
      sqsEventFromBodies([
        {
          userId,
          entitlementKey,
          amount: 5,
        },
      ]),
    );

    const result = await docClient().send(
      new ScanCommand({
        TableName: "usage-logs-test",
        Limit: 10,
      }),
    );

    expect(result.Items?.length).toBeGreaterThan(0);

    const log = result.Items?.[0];

    expect(log).toMatchObject({
      PK: `USER#${userId}`,
      userId,
      entitlementKey,
      delta: 5,
      previousUsed: 10,
      newUsed: 15,
    });

    const ttl = log?.ttl as number;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expectedTtlMin = nowSeconds + 90 * 24 * 60 * 60 - 60;
    const expectedTtlMax = nowSeconds + 90 * 24 * 60 * 60 + 60;

    expect(ttl).toBeGreaterThanOrEqual(expectedTtlMin);
    expect(ttl).toBeLessThanOrEqual(expectedTtlMax);
  });

  it("handles many usage records within a certain time constraint", async () => {
    jest.setTimeout(30000);

    const batchUserId = `batch-user-${Date.now()}`;
    await createEntitlement({ userId: batchUserId, used: 0, limit: 1000 });

    const records = Array.from({ length: 100 }, () => ({
      userId: batchUserId,
      entitlementKey,
      amount: 1,
    }));

    const startedAt = Date.now();
    const result = await handler(sqsEventFromBodies(records));
    const durationMs = Date.now() - startedAt;

    expect(result.batchItemFailures).toEqual([]);
    expect(durationMs).toBeLessThan(15000);

    const entitlement = await entitlementRepository.findByUserAndKey(
      batchUserId,
      entitlementKey,
    );

    expect(entitlement?.usage?.used).toBe(100);
  });
});
