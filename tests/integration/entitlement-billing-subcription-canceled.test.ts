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

type BillingDomainEvent<TPayload = any> =
  BillingEvent.BillingDomainEvent<TPayload>;

describe("subscription canceled", () => {
  let productRepo!: DynamoProductRepository;
  let entitlementRepo!: DynamoEntitlementRepository;
  let processedPaymentsRepo!: DynamoProcessedPaymentsRepository;
  let useCase!: ProcessBillingEventUseCase;
  let eventPublisher!: EntitlementEventPublisher;

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

  it("should revoke access when subscription is cancelled", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.canceled", {
        userId,
        productId,
        cancelAtPeriodEnd: false,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("revoked");
    expect(entitlement!.expiresAt).toBeUndefined();
    expect(eventPublisher.publishRevoked).toHaveBeenCalled();
  });

  it("should preserve permanent limit when subscription is cancelled immediately", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 25,
          period: "week",
        },
      ],
    });

    await useCase.execute(
      createBillingDomainEvent("payment.successful", {
        paymentIntentId: `pi-${Date.now()}`,
        userId,
        amount: 250,
        currency: "USD",
        priceId: "price_test",
        productId,
        billingType: "one_time",
        provider: "stripe",
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.canceled", {
        userId,
        productId,
        cancelAtPeriodEnd: false,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("active");
    expect(entitlement!.expiresAt).toBeUndefined();
    expect(entitlement!.usage?.limit).toBe(0);
    expect(entitlement!.usage?.permanentLimit).toBe(25);
    expect(entitlement!.usage?.getEffectiveLimit()).toBe(25);
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(1);
  });

  it("subscription cancelled and permanent limit has been used up", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 10,
          period: "hour",
        },
      ],
    });

    await useCase.execute(
      createBillingDomainEvent("payment.successful", {
        paymentIntentId: `pi-${Date.now()}`,
        userId,
        amount: 300,
        currency: "TTD",
        priceId: "price_test",
        productId,
        billingType: "one_time",
        provider: "stripe",
      }),
    );

    const entitlementAccess = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementAccess).not.toBeNull();
    expect(entitlementAccess!.usage?.permanentLimit).toBe(10);
    expect(entitlementAccess!.usage?.used).toBe(0);

    entitlementAccess!.usage!.used = 10;
    await entitlementRepo.update(entitlementAccess!);

    await useCase.execute(
      createBillingDomainEvent("subscription.updated", {
        userId,
        productId,
        currentPeriodStart: isoDaysFromNow(-1),
        currentPeriodEnd: isoDaysFromNow(30),
        addonProductIds: [],
      }),
    );

    const entitlementAccessAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementAccessAfter).not.toBeNull();
    expect(entitlementAccessAfter!.usage?.used).toBe(10);
    expect(eventPublisher.publishUpdated).toHaveBeenCalledTimes(1);

    await useCase.execute(
      createBillingDomainEvent("subscription.canceled", {
        userId,
        productId,
        cancelAtPeriodEnd: false,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("active");
    expect(entitlement!.expiresAt).toBeUndefined();
    expect(entitlement!.usage?.limit).toBe(0);
    expect(entitlement!.usage?.permanentLimit).toBe(10);
    expect(entitlement!.usage?.canConsume(1)).toBe(false);
    expect(() => entitlement!.usage!.consume(1)).toThrow(
      "Entitlement usage exceeded",
    );
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(1);
  });

  it("should revoke access at period end when subscription is cancelled with cancelAtPeriodEnd=true", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.canceled", {
        userId,
        productId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("active");
    expect(entitlement!.expiresAt?.toISOString()).toBe(currentPeriodEnd);
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(1);
  });

  it("should not revoke access if subscription cancellation event is received before subscription creation event", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.canceled", {
        userId,
        productId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement!.status).toBe("active");
    expect(entitlement!.expiresAt?.toISOString()).toBe(currentPeriodEnd);
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(1);
  });
});
