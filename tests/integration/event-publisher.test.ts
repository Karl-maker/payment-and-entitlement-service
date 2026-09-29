import { BillingEvent, type Entitlement } from "@libs/domain";
import { EntitlementEventPublisher } from "../../services/entitlement-service/src/infrastructure/event.publisher";
import {
  createSnsTopic,
  createQueueSubscribedToSns,
  drainAllMessagesFromQueue,
  purgeQueue,
  receiveOneMessageFromQueue,
  setTestEnvVars,
} from "../helpers/localstack";

describe("EntitlementEventPublisher", () => {
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    setTestEnvVars();
    topicArn = await createSnsTopic(`entitlement-updates-int-${Date.now()}`);
    process.env.ENTITLEMENT_UPDATES_TOPIC_ARN = topicArn;
    queueUrl = await createQueueSubscribedToSns(
      `entitlement-updates-int-q-${Date.now()}`,
      topicArn,
    );
  });

  beforeEach(async () => {
    await purgeQueue(queueUrl);
  });

  it("publishes created events", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    const meta = {
      eventId: "evt-created-1",
      occurredAt: "2026-04-24T10:00:00.000Z",
      source: "internal" as const,
    };

    await publisher.publishCreated(
      {
        userId: "user-1",
        entitlementKey: "subject_access",
        status: "active",
        reason: "subscription.created",
      },
      meta,
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      type: BillingEvent.EntitlementEventType.ENTITLEMENT_CREATED,
      payload: {
        userId: "user-1",
        entitlementKey: "subject_access",
        status: "active",
        reason: "subscription.created",
      },
      meta,
      version: 1,
    });
  });

  it("publishes updated events", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    const meta = {
      eventId: "evt-updated-1",
      occurredAt: "2026-04-24T11:00:00.000Z",
      source: "internal" as const,
    };

    await publisher.publishUpdated(
      {
        userId: "user-2",
        entitlementKey: "token",
        status: "inactive",
        reason: "subscription.updated",
        expiresAt: "2026-05-24T00:00:00.000Z",
      },
      meta,
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      type: BillingEvent.EntitlementEventType.ENTITLEMENT_UPDATED,
      payload: {
        userId: "user-2",
        entitlementKey: "token",
        status: "inactive",
        reason: "subscription.updated",
        expiresAt: "2026-05-24T00:00:00.000Z",
      },
      meta,
      version: 1,
    });
  });

  it("publishes revoked events", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    const meta = {
      eventId: "evt-revoked-1",
      occurredAt: "2026-04-24T12:00:00.000Z",
      source: "internal" as const,
    };

    await publisher.publishRevoked(
      {
        userId: "user-3",
        entitlementKey: "subject_access",
        status: "inactive",
        reason: "subscription.canceled",
      },
      meta,
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      type: BillingEvent.EntitlementEventType.ENTITLEMENT_REVOKED,
      payload: {
        userId: "user-3",
        entitlementKey: "subject_access",
        status: "inactive",
        reason: "subscription.canceled",
      },
      meta,
      version: 1,
    });
  });

  it("publishes availability_updated with a numeric currentAvailableUsage", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    await publisher.publishAvailabilityUpdated("user-4", "token", 42);

    const received = await receiveOneMessageFromQueue<{
      type: string;
      payload: {
        userId: string;
        key: string;
        currentAvailableUsage: number | null;
      };
      meta: {
        eventId: string;
        occurredAt: string;
        source: string;
      };
      version: number;
    }>(queueUrl);

    expect(received).not.toBeNull();
    expect(received!.body.type).toBe(
      BillingEvent.EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED,
    );
    expect(received!.body.payload.userId).toBe("user-4");
    expect(received!.body.payload.key).toBe("token");
    expect(received!.body.payload.currentAvailableUsage).toBe(42);
    expect(received!.body.meta.source).toBe("internal");
    expect(received!.body.version).toBe(1);
  });

  it("publishes availability_updated with null currentAvailableUsage", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    await publisher.publishAvailabilityUpdated(
      "user-5",
      "subject_access",
      null,
    );

    const received = await receiveOneMessageFromQueue<{
      type: string;
      payload: {
        userId: string;
        key: string;
        currentAvailableUsage: number | null;
      };
    }>(queueUrl);

    expect(received).not.toBeNull();
    expect(received!.body.type).toBe(
      BillingEvent.EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED,
    );
    expect(received!.body.payload.userId).toBe("user-5");
    expect(received!.body.payload.key).toBe("subject_access");
    expect(received!.body.payload.currentAvailableUsage).toBeNull();
  });

  it("publishAvailabilityFromEntitlement computes currentAvailableUsage", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    const entitlement = {
      userId: "user-6",
      key: "token",
      usage: {
        used: 12,
        getEffectiveLimit: () => 50,
      },
    } as unknown as Entitlement;

    await publisher.publishAvailabilityFromEntitlement(entitlement);

    const received = await receiveOneMessageFromQueue<{
      type: string;
      payload: {
        userId: string;
        key: string;
        currentAvailableUsage: number | null;
      };
    }>(queueUrl);

    expect(received).not.toBeNull();
    expect(received!.body.payload.userId).toBe("user-6");
    expect(received!.body.payload.key).toBe("token");
    expect(received!.body.payload.currentAvailableUsage).toBe(38);
  });

  it("multiple publishes produce multiple messages", async () => {
    const publisher = new EntitlementEventPublisher(topicArn);

    await publisher.publishCreated(
      {
        userId: "user-7",
        entitlementKey: "subject_access",
        status: "active",
        reason: "subscription.created",
      },
      {
        eventId: "evt-7a",
        occurredAt: "2026-04-24T13:00:00.000Z",
        source: "internal",
      },
    );

    await publisher.publishAvailabilityUpdated("user-7", "token", 11);

    const bodies = await drainAllMessagesFromQueue(queueUrl);

    expect(bodies).toHaveLength(2);
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: BillingEvent.EntitlementEventType.ENTITLEMENT_CREATED,
          payload: expect.objectContaining({
            userId: "user-7",
            entitlementKey: "subject_access",
          }),
        }),
        expect.objectContaining({
          type: BillingEvent.EntitlementEventType
            .ENTITLEMENT_AVAILABILITY_UPDATED,
          payload: expect.objectContaining({
            userId: "user-7",
            key: "token",
            currentAvailableUsage: 11,
          }),
        }),
      ]),
    );
  });
});
