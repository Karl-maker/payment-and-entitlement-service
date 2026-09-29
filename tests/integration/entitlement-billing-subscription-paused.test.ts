import { jest } from "@jest/globals";
import {
  BillingEvent,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  DynamoProductRepository,
  DynamoEntitlementRepository,
  EntitlementKey,
} from "@libs/domain";
import { ProcessBillingEventUseCase } from "../../services/entitlement-service/src/app/usecases/process.billing.event.usecase";
import { EntitlementEventPublisher } from "../../services/entitlement-service/src/infrastructure/event.publisher";
import { DynamoProcessedPaymentsRepository } from "../../services/entitlement-service/src/infrastructure/processed-payments.repository";
import { createBillingDomainEvent } from "../helpers/billing";
import { isoDaysFromNow } from "../helpers/dates";
import { createProduct } from "../helpers/product";
import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
  docClient,
} from "../helpers/localstack";

describe("subscription paused", () => {
  let productRepo!: DynamoProductRepository;
  let entitlementRepo!: DynamoEntitlementRepository;
  let processedPaymentsRepo!: DynamoProcessedPaymentsRepository;
  let useCase!: ProcessBillingEventUseCase;
  let eventPublisher!: EntitlementEventPublisher;
  let consoleLogSpy!: jest.SpiedFunction<typeof console.log>;

  const createdProductIds: string[] = [];

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();

    productRepo = new DynamoProductRepository();
    entitlementRepo = new DynamoEntitlementRepository(
      TABLE_NAMES.entitlements,
      docClient(),
    );
    processedPaymentsRepo = new DynamoProcessedPaymentsRepository(
      TABLE_NAMES.processedEvents,
      docClient(),
    );

    eventPublisher = {
      publishCreated: jest.fn(async () => undefined),
      publishUpdated: jest.fn(async () => undefined),
      publishRevoked: jest.fn(async () => undefined),
      publishAvailabilityFromEntitlement: jest.fn(async () => undefined),
    } as unknown as EntitlementEventPublisher;

    const createEntitlementUseCase = new CreateEntitlementUseCase(
      entitlementRepo,
    );
    const syncProductLimitsUseCase = new SyncProductLimitsToEntitlementsUseCase(
      productRepo,
      entitlementRepo,
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
    jest.clearAllMocks();
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

  it("should not revoke entitlements if subscription is paused and entitlement remains active", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId: productId,
      entitlements: [EntitlementKey.AI_TUTOR_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodStart: isoDaysFromNow(0),
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("active");

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
      }),
    );

    const entitlementAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );

    expect(entitlementAfter).not.toBeNull();
    expect(entitlementAfter!.status).toBe("active");
    expect(eventPublisher.publishCreated).toHaveBeenCalledTimes(1);
  });

  it("should keep the other subscription untouched when one subscription is paused", async () => {
    const userId = `user-${Date.now()}`;
    const pausedProductId = `prod-${Date.now()}`;
    const activeProductId = `prod-active-${Date.now()}`;
    const pausedPeriodEnd = isoDaysFromNow(30);
    const activePeriodEnd = isoDaysFromNow(45);

    await createProduct(productRepo, createdProductIds, {
      productId: pausedProductId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    await createProduct(productRepo, createdProductIds, {
      productId: activeProductId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${pausedProductId}`,
        userId,
        productId: pausedProductId,
        currentPeriodEnd: pausedPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${activeProductId}`,
        userId,
        productId: activeProductId,
        currentPeriodEnd: activePeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        subscriptionId: `sub-${pausedProductId}`,
        userId,
        productId: pausedProductId,
        currentPeriodEnd: pausedPeriodEnd,
        addonProductIds: [],
      }),
    );

    const pausedEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    const activeEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(pausedEntitlement).not.toBeNull();
    expect(activeEntitlement).not.toBeNull();

    expect(pausedEntitlement!.status).toBe("active");
    expect(pausedEntitlement!.expiresAt?.toISOString()).toBe(pausedPeriodEnd);

    expect(activeEntitlement!.status).toBe("active");
    expect(activeEntitlement!.expiresAt?.toISOString()).toBe(activePeriodEnd);
  });

  it("does not reset or change usage-based entitlements on subscription.paused", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

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
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const entitlementbefore = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementbefore).not.toBeNull();
    entitlementbefore!.usage!.used = 37;
    await entitlementRepo.update(entitlementbefore!);

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const entitlementAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementAfter).not.toBeNull();
    expect(entitlementAfter!.status).toBe("active");
    expect(entitlementAfter!.usage?.limit).toBe(100);
    expect(entitlementAfter!.usage?.used).toBe(37);
    expect(eventPublisher.publishRevoked).not.toHaveBeenCalled();
  });

  it("is idempotent when subscription.paused is received twice", async () => {
    // receives the same status after processing the same event twice
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const firstEntitlementCall = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const secondEntitlementCall = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    expect(secondEntitlementCall).not.toBeNull();
    expect(secondEntitlementCall!.status).toBe(firstEntitlementCall!.status);
    expect(secondEntitlementCall!.expiresAt?.toISOString()).toBe(
      firstEntitlementCall!.expiresAt?.toISOString(),
    );
    expect(secondEntitlementCall!.usage?.limit).toBe(
      firstEntitlementCall!.usage?.limit,
    );
    expect(secondEntitlementCall!.usage?.used).toBe(
      firstEntitlementCall!.usage?.used,
    );
  });
});
