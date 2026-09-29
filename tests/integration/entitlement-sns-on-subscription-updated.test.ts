import {
  BillingEvent,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  DynamoProductRepository,
  DynamoEntitlementRepository,
  EntitlementKey,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { ProcessBillingEventUseCase } from "../../services/entitlement-service/src/app/usecases/process.billing.event.usecase";
import { EntitlementEventPublisher } from "../../services/entitlement-service/src/infrastructure/event.publisher";
import { DynamoProcessedPaymentsRepository } from "../../services/entitlement-service/src/infrastructure/processed-payments.repository";
import { createBillingDomainEvent, createBillingMeta } from "../helpers/billing";
import { isoDaysFromNow } from "../helpers/dates";
import { createProduct } from "../helpers/product";
import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
  docClient,
  createSnsTopic,
  createQueueSubscribedToSns,
  purgeQueue,
  drainAllMessagesFromQueue,
} from "../helpers/localstack";

const SubscriptionEventType = BillingEvent.SubscriptionEventType;
const PaymentEventType = BillingEvent.PaymentEventType;
const EntitlementEventType = BillingEvent.EntitlementEventType;

type EntitlementUpdatedBody = {
  type: string;
  payload: {
    userId: string;
    entitlementKey: string;
    role?: string;
    status: "active" | "inactive";
    expiresAt?: string;
    usageLimit?: { limit: number; used: number };
    productId?: string;
    reason: string;
  };
  meta: { eventId: string; occurredAt: string; source?: string };
  version: number;
};

function isEntitlementUpdated(
  body: unknown,
): body is EntitlementUpdatedBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    (body as { type: string }).type === EntitlementEventType.ENTITLEMENT_UPDATED
  );
}

type EntitlementCreatedBody = EntitlementUpdatedBody & {
  type: typeof EntitlementEventType.ENTITLEMENT_CREATED;
};

function isEntitlementCreated(body: unknown): body is EntitlementCreatedBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    (body as { type: string }).type === EntitlementEventType.ENTITLEMENT_CREATED
  );
}

type AvailabilityUpdatedBody = {
  type: typeof EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED;
  payload: {
    userId: string;
    key: string;
    currentAvailableUsage: number | null;
  };
  meta: { eventId: string; occurredAt: string; source?: string };
  version: number;
};

function isAvailabilityUpdated(body: unknown): body is AvailabilityUpdatedBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    (body as { type: string }).type ===
      EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED
  );
}

/** Final availability for a key — the handler may emit before and after sync. */
function lastAvailabilityForKey(
  bodies: unknown[],
  key: string,
): AvailabilityUpdatedBody | undefined {
  const list = bodies
    .filter(isAvailabilityUpdated)
    .filter((b) => b.payload.key === key);
  return list.length ? list[list.length - 1] : undefined;
}

/**
 * Covers SNS wiring for ProcessBillingEventUseCase + EntitlementEventPublisher.
 * It does not prove every code path: subscription flows use entitlement.updated vs
 * entitlement.created vs entitlement.revoked depending on `reason` in publishEntitlementEvents.
 */
describe("Entitlement service → SNS (integration)", () => {
  let productRepo!: DynamoProductRepository;
  let entitlementRepo!: DynamoEntitlementRepository;
  let processedPaymentsRepo!: DynamoProcessedPaymentsRepository;
  let useCase!: ProcessBillingEventUseCase;
  let topicArn!: string;
  let queueUrl!: string;

  const createdProductIds: string[] = [];

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();

    const suffix = `${Date.now()}`;
    topicArn = await createSnsTopic(`entitlement-int-sub-updated-${suffix}`);
    process.env.ENTITLEMENT_UPDATES_TOPIC_ARN = topicArn;
    queueUrl = await createQueueSubscribedToSns(
      `entitlement-int-sub-updated-q-${suffix}`,
      topicArn,
    );

    productRepo = new DynamoProductRepository();
    entitlementRepo = new DynamoEntitlementRepository(
      TABLE_NAMES.entitlements,
      docClient(),
    );
    processedPaymentsRepo = new DynamoProcessedPaymentsRepository(
      TABLE_NAMES.processedEvents,
      docClient(),
    );

    const eventPublisher = new EntitlementEventPublisher(topicArn);
    const createEntitlementUseCase = new CreateEntitlementUseCase(
      entitlementRepo,
    );
    const entitlementUpdateNotifier: EntitlementUpdateNotifier = {
      notify: (e) => eventPublisher.publishAvailabilityFromEntitlement(e),
    };
    const syncProductLimitsUseCase = new SyncProductLimitsToEntitlementsUseCase(
      productRepo,
      entitlementRepo,
      entitlementUpdateNotifier,
    );

    useCase = new ProcessBillingEventUseCase(
      createEntitlementUseCase,
      syncProductLimitsUseCase,
      eventPublisher,
      entitlementRepo,
      productRepo,
      undefined,
      processedPaymentsRepo,
    );
  });

  beforeEach(async () => {
    await purgeQueue(queueUrl);
    await clearTable(TABLE_NAMES.entitlements);
    await clearTable(TABLE_NAMES.processedEvents, ["eventId"]);
  });

  afterEach(async () => {
    for (const productId of createdProductIds.splice(0)) {
      await productRepo.delete(productId);
    }
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  it("publishes entitlement.updated to SNS when subscription.updated updates an existing entitlement", async () => {
    const userId = `user-sns-${Date.now()}`;
    const productId = `prod-sns-${Date.now()}`;
    const periodEndInitial = isoDaysFromNow(30);
    const periodStartUpdated = isoDaysFromNow(1);
    const periodEndUpdated = isoDaysFromNow(60);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    const metaCreated = createBillingMeta({ eventId: `evt-created-${Date.now()}` });
    await useCase.execute(
      createBillingDomainEvent(
        SubscriptionEventType.SUBSCRIPTION_CREATED,
        {
          subscriptionId: `sub-${productId}`,
          userId,
          productId,
          priceId: "price_test",
          status: "active" as const,
          currentPeriodStart: isoDaysFromNow(0),
          currentPeriodEnd: periodEndInitial,
          addonProductIds: [],
        },
        metaCreated,
      ),
    );

    await drainAllMessagesFromQueue(queueUrl);

    const metaUpdated = createBillingMeta({ eventId: `evt-updated-${Date.now()}` });
    await useCase.execute(
      createBillingDomainEvent(
        SubscriptionEventType.SUBSCRIPTION_UPDATED,
        {
          subscriptionId: `sub-${productId}`,
          userId,
          productId,
          priceId: "price_test",
          status: "active" as const,
          currentPeriodStart: periodStartUpdated,
          currentPeriodEnd: periodEndUpdated,
          addonProductIds: [],
        },
        metaUpdated,
      ),
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);
    const updated = bodies.find(isEntitlementUpdated);

    expect(updated).toBeDefined();
    expect(updated!.payload.userId).toBe(userId);
    expect(updated!.payload.entitlementKey).toBe(EntitlementKey.SUBJECT_ACCESS);
    expect(updated!.payload.productId).toBe(productId);
    expect(updated!.payload.reason).toBe("subscription.updated");
    expect(updated!.payload.status).toBe("active");
    expect(updated!.payload.expiresAt).toBe(new Date(periodEndUpdated).toISOString());
    expect(updated!.meta.eventId).toBe(metaUpdated.eventId);
    expect(updated!.meta.source).toBe("internal");
    expect(updated!.version).toBe(1);
  });

  it("is idempotent for the test harness: purge + same flow yields the same entitlement.updated shape", async () => {
    const userId = `user-sns-idem-${Date.now()}`;
    const productId = `prod-sns-idem-${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    const runOnce = async () => {
      await purgeQueue(queueUrl);
      await clearTable(TABLE_NAMES.entitlements);

      await useCase.execute(
        createBillingDomainEvent(
          SubscriptionEventType.SUBSCRIPTION_CREATED,
          {
            subscriptionId: `sub-idem-${productId}`,
            userId,
            productId,
            priceId: "price_test",
            status: "active" as const,
            currentPeriodStart: isoDaysFromNow(0),
            currentPeriodEnd: isoDaysFromNow(30),
            addonProductIds: [],
          },
          createBillingMeta(),
        ),
      );
      await drainAllMessagesFromQueue(queueUrl);

      await useCase.execute(
        createBillingDomainEvent(
          SubscriptionEventType.SUBSCRIPTION_UPDATED,
          {
            subscriptionId: `sub-idem-${productId}`,
            userId,
            productId,
            priceId: "price_test",
            status: "active" as const,
            currentPeriodStart: isoDaysFromNow(1),
            currentPeriodEnd: isoDaysFromNow(60),
            addonProductIds: [],
          },
          createBillingMeta(),
        ),
      );

      const bodies = await drainAllMessagesFromQueue(queueUrl);
      const updated = bodies.find(isEntitlementUpdated);
      expect(updated?.payload.reason).toBe("subscription.updated");
      expect(updated?.payload.userId).toBe(userId);
    };

    await runOnce();
    await runOnce();
  });

  it("publishes entitlement.created (not updated) for one-time payment.successful", async () => {
    const userId = `user-otp-${Date.now()}`;
    const productId = `prod-otp-${Date.now()}`;
    const paymentIntentId = `pi_otp_${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    const meta = createBillingMeta({ eventId: `evt-pay-${Date.now()}` });
    await useCase.execute(
      createBillingDomainEvent(
        PaymentEventType.PAYMENT_SUCCESSFUL,
        {
          paymentIntentId,
          userId,
          amount: 1000,
          currency: "usd",
          priceId: "price_test",
          productId,
          billingType: "one_time",
          provider: "stripe",
        },
        meta,
      ),
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);
    const created = bodies.find(isEntitlementCreated);

    expect(created).toBeDefined();
    expect(created!.payload.reason).toBe("payment.successful");
    expect(created!.payload.userId).toBe(userId);
    expect(created!.payload.entitlementKey).toBe(EntitlementKey.SUBJECT_ACCESS);
    expect(created!.payload.productId).toBe(productId);
    expect(created!.meta.eventId).toBe(meta.eventId);
    expect(bodies.filter(isEntitlementUpdated)).toHaveLength(0);
  });

  it("does not publish SNS entitlement events when the same one-off paymentIntentId is processed twice", async () => {
    const userId = `user-otp-idem-${Date.now()}`;
    const productId = `prod-otp-idem-${Date.now()}`;
    const paymentIntentId = `pi_otp_idem_${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    const payload = {
      paymentIntentId,
      userId,
      amount: 500,
      currency: "usd",
      priceId: "price_test",
      productId,
      billingType: "one_time" as const,
      provider: "stripe" as const,
    };

    await useCase.execute(
      createBillingDomainEvent(
        PaymentEventType.PAYMENT_SUCCESSFUL,
        payload,
        createBillingMeta({ eventId: `evt-1-${Date.now()}` }),
      ),
    );
    await drainAllMessagesFromQueue(queueUrl);

    await useCase.execute(
      createBillingDomainEvent(
        PaymentEventType.PAYMENT_SUCCESSFUL,
        payload,
        createBillingMeta({ eventId: `evt-2-${Date.now()}` }),
      ),
    );

    const afterReplay = await drainAllMessagesFromQueue(queueUrl);
    expect(afterReplay.filter(isEntitlementCreated)).toHaveLength(0);
    expect(afterReplay.filter(isEntitlementUpdated)).toHaveLength(0);
  });

  it("publishes entitlement.availability_updated after sync (effective limit − used) when product has usage limits", async () => {
    const userId = `user-sync-avail-${Date.now()}`;
    const productId = `prod-sync-avail-${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 100,
          period: "billing_cycle",
        },
      ],
    });

    await useCase.execute(
      createBillingDomainEvent(
        SubscriptionEventType.SUBSCRIPTION_CREATED,
        {
          subscriptionId: `sub-sync-${productId}`,
          userId,
          productId,
          priceId: "price_test",
          status: "active" as const,
          currentPeriodStart: isoDaysFromNow(0),
          currentPeriodEnd: isoDaysFromNow(30),
          addonProductIds: [],
        },
        createBillingMeta(),
      ),
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);
    const availability = lastAvailabilityForKey(
      bodies,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(availability).toBeDefined();
    expect(availability!.payload.userId).toBe(userId);
    expect(availability!.payload.currentAvailableUsage).toBe(100);
  });

  it("stacks permanent limits on repeated one-time payments; availability uses getEffectiveLimit() − used", async () => {
    const userId = `user-otp-stack-${Date.now()}`;
    const productId = `prod-otp-stack-${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 25,
          period: "lifetime",
        },
      ],
    });

    const pay = (pi: string) =>
      useCase.execute(
        createBillingDomainEvent(
          PaymentEventType.PAYMENT_SUCCESSFUL,
          {
            paymentIntentId: pi,
            userId,
            amount: 999,
            currency: "usd",
            priceId: "price_test",
            productId,
            billingType: "one_time",
            provider: "stripe",
          },
          createBillingMeta(),
        ),
      );

    await pay(`pi_stack_a_${Date.now()}`);
    await drainAllMessagesFromQueue(queueUrl);

    await pay(`pi_stack_b_${Date.now()}`);
    const bodies = await drainAllMessagesFromQueue(queueUrl);

    const availability = lastAvailabilityForKey(
      bodies,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(availability?.payload.currentAvailableUsage).toBe(50);
  });

  it("after billing-cycle renewal, resets used and SNS shows full availability and usageLimit.used 0 on entitlement.updated", async () => {
    const userId = `user-renew-${Date.now()}`;
    const productId = `prod-renew-${Date.now()}`;
    const periodEndInitial = isoDaysFromNow(30);
    const periodStartRenewal = isoDaysFromNow(31);
    const periodEndRenewal = isoDaysFromNow(90);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 200,
          period: "billing_cycle",
        },
      ],
    });

    await useCase.execute(
      createBillingDomainEvent(
        SubscriptionEventType.SUBSCRIPTION_CREATED,
        {
          subscriptionId: `sub-renew-${productId}`,
          userId,
          productId,
          priceId: "price_test",
          status: "active" as const,
          currentPeriodStart: isoDaysFromNow(0),
          currentPeriodEnd: periodEndInitial,
          addonProductIds: [],
        },
        createBillingMeta(),
      ),
    );
    await drainAllMessagesFromQueue(queueUrl);

    const before = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );
    expect(before?.usage).toBeDefined();
    before!.usage!.used = 77;
    await entitlementRepo.update(before!);

    await useCase.execute(
      createBillingDomainEvent(
        SubscriptionEventType.SUBSCRIPTION_UPDATED,
        {
          subscriptionId: `sub-renew-${productId}`,
          userId,
          productId,
          priceId: "price_test",
          status: "active" as const,
          currentPeriodStart: periodStartRenewal,
          currentPeriodEnd: periodEndRenewal,
          addonProductIds: [],
        },
        createBillingMeta(),
      ),
    );

    const bodies = await drainAllMessagesFromQueue(queueUrl);

    const availability = bodies.filter(isAvailabilityUpdated).find(
      (b) => b.payload.key === EntitlementKey.QUESTION_GENERATION,
    );
    const updated = bodies.find(isEntitlementUpdated);

    expect(availability?.payload.currentAvailableUsage).toBe(200);
    expect(updated?.payload.usageLimit?.used).toBe(0);
    expect(updated?.payload.usageLimit?.limit).toBe(200);

    const stored = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );
    expect(stored?.usage?.used).toBe(0);
  });
});
