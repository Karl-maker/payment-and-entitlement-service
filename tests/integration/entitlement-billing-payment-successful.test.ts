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

describe("payment successful", () => {
  let productRepo!: DynamoProductRepository;
  let entitlementRepo!: DynamoEntitlementRepository;
  let processedPaymentsRepo!: DynamoProcessedPaymentsRepository;
  let useCase!: ProcessBillingEventUseCase;
  let eventPublisher!: EntitlementEventPublisher;
  let createEntitlementUseCase!: CreateEntitlementUseCase;

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

    createEntitlementUseCase = new CreateEntitlementUseCase(entitlementRepo);
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

  it("creates an entitlement when a payment is successful", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const subscriptionId = `sub-${Date.now()}`;
    const periodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId: productId,
      entitlements: [EntitlementKey.AI_TUTOR_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("payment.successful", {
        paymentIntentId: `pay-${Date.now()}`,
        userId,
        amount: 250,
        currency: "USD",
        priceId: "price_test",
        productId,
        subscriptionId,
        billingType: "recurring",
        provider: "stripe",
      }),
    );

    const entitlements = await entitlementRepo.findByUser(userId);
    expect(entitlements).toHaveLength(1);
    expect(eventPublisher.publishCreated).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publishUpdated).not.toHaveBeenCalled();
    expect(eventPublisher.publishRevoked).not.toHaveBeenCalled();
  });

  it("treats a recurring payment.successful without subscriptionId as one-time", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const paymentIntentId = `pay-${Date.now()}`;

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
        paymentIntentId,
        userId,
        amount: 2500,
        currency: "USD",
        priceId: "price_test",
        productId,
        billingType: "recurring",
        provider: "stripe",
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlement).not.toBeNull();
    expect(entitlement?.expiresAt).toBeUndefined();
    expect(entitlement?.usage?.limit).toBe(0);
    expect(entitlement?.usage?.permanentLimit).toBe(25);
  });

  it("logs and skips when payment.successful has no productId", async () => {
    const consoleSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await useCase.execute(
      createBillingDomainEvent("payment.successful", {
        paymentIntentId: `pi-${Date.now()}`,
        userId: `user-${Date.now()}`,
        amount: 1000,
        currency: "USD",
        priceId: "price_test",
        billingType: "one_time",
        provider: "stripe",
      }),
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "Payment successful but no productId, skipping entitlement creation",
    );

    consoleSpy.mockRestore();
  });

  it("skips the second delivery of the same one-time paymentIntentId", async () => {
    const consoleSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const paymentIntentId = `pay-${Date.now()}`;

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

    const payload = {
      paymentIntentId,
      userId,
      amount: 250,
      currency: "USD",
      priceId: "price_test",
      productId,
      billingType: "one_time",
      provider: "stripe",
    };

    await useCase.execute(
      createBillingDomainEvent("payment.successful", payload),
    );
    await useCase.execute(
      createBillingDomainEvent("payment.successful", payload),
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      `One-off payment ${paymentIntentId} already applied, skipping duplicate`,
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlement?.usage?.permanentLimit).toBe(25);

    consoleSpy.mockRestore();
  });
});
