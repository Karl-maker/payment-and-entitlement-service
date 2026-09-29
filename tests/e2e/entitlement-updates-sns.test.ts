import {
  createSnsTopic,
  createQueueSubscribedToSns,
  receiveOneMessageFromQueue,
  setTestEnvVars,
} from "../helpers/localstack";

describe("Entitlement Updates SNS E2E", () => {
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    setTestEnvVars();
    topicArn = await createSnsTopic("entitlement-updates-e2e-test");
    process.env.ENTITLEMENT_UPDATES_TOPIC_ARN = topicArn;
    queueUrl = await createQueueSubscribedToSns(
      "entitlement-updates-e2e-queue",
      topicArn
    );
  });

  it("should publish entitlement.availability_updated with key, userId, and currentAvailableUsage", async () => {
    const { EntitlementEventPublisher } = await import(
      "../../services/entitlement-service/src/infrastructure/event.publisher"
    );
    const publisher = new EntitlementEventPublisher(topicArn);

    await publisher.publishAvailabilityUpdated("user-e2e-1", "token", 42);

    const received = await receiveOneMessageFromQueue<{
      type: string;
      payload: { userId: string; key: string; currentAvailableUsage: number | null };
    }>(queueUrl);

    expect(received).not.toBeNull();
    expect(received!.body.type).toBe("entitlement.availability_updated");
    expect(received!.body.payload.userId).toBe("user-e2e-1");
    expect(received!.body.payload.key).toBe("token");
    expect(received!.body.payload.currentAvailableUsage).toBe(42);
  });

  it("should publish currentAvailableUsage null for non-usage entitlements", async () => {
    const { EntitlementEventPublisher } = await import(
      "../../services/entitlement-service/src/infrastructure/event.publisher"
    );
    const publisher = new EntitlementEventPublisher(topicArn);

    await publisher.publishAvailabilityUpdated("user-e2e-2", "subject_access", null);

    const received = await receiveOneMessageFromQueue<{
      type: string;
      payload: { userId: string; key: string; currentAvailableUsage: number | null };
    }>(queueUrl);

    expect(received).not.toBeNull();
    expect(received!.body.payload.currentAvailableUsage).toBeNull();
    expect(received!.body.payload.key).toBe("subject_access");
  });
});
