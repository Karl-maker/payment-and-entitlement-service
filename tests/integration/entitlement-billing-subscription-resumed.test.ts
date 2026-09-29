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

describe("subscription resumed", () => {
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

  it("resumes a subscription successfully", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const initialPeriodEnd = isoDaysFromNow(7);
    const resumedPeriodEnd = isoDaysFromNow(30);
    const consoleSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await createProduct(productRepo, createdProductIds, {
      productId: productId,
      entitlements: [EntitlementKey.AI_TUTOR_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        susbscriptionId: `sub-${Date.now()}`,
        productId: productId,
        userId: userId,
        currentPeriodEnd: initialPeriodEnd,
      }),
    );

    const entitlementBefore = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );
    expect(entitlementBefore).toBeDefined();
    expect(entitlementBefore?.status).toEqual("active");
    expect(entitlementBefore?.expiresAt?.toISOString()).toEqual(
      initialPeriodEnd,
    );
    expect(eventPublisher.publishCreated).toHaveBeenCalledTimes(1);

    await useCase.execute(
      createBillingDomainEvent("subscription.paused", {
        susbscriptionId: `sub-${Date.now()}`,
        productId: productId,
        userId: userId,
        currentPeriodEnd: initialPeriodEnd,
      }),
    );

    const entitlementPaused = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );
    expect(entitlementPaused).toBeDefined();
    expect(entitlementPaused?.status).toEqual("active");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Subscription paused for user ${userId}, entitlements remain active`,
      ),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.resumed", {
        susbscriptionId: `sub-${Date.now()}`,
        productId: productId,
        userId: userId,
        currentPeriodEnd: resumedPeriodEnd,
      }),
    );

    const entitlementAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );

    expect(entitlementAfter?.expiresAt?.toISOString()).toEqual(
      resumedPeriodEnd,
    );
    expect(entitlementAfter?.status).toEqual("active");

    consoleSpy.mockRestore();
  });

  it("is idempotent when subscription.resumed is received twice", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const initialPeriodEnd = isoDaysFromNow(7);
    const resumedPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      entitlements: [EntitlementKey.AI_TUTOR_ACCESS],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd: initialPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.resumed", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd: resumedPeriodEnd,
        addonProductIds: [],
      }),
    );

    const first = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );

    expect(first).toBeDefined();
    expect(first?.status).toBe("active");
    expect(first?.expiresAt?.toISOString()).toBe(resumedPeriodEnd);
    expect(eventPublisher.publishUpdated).toHaveBeenCalledTimes(1);

    await useCase.execute(
      createBillingDomainEvent("subscription.resumed", {
        subscriptionId: `sub-${productId}`,
        userId,
        productId,
        currentPeriodEnd: resumedPeriodEnd,
        addonProductIds: [],
      }),
    );

    const second = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.AI_TUTOR_ACCESS,
    );

    expect(second).toBeDefined();
    expect(second?.status).toBe("active");
    expect(second?.expiresAt?.toISOString()).toBe(resumedPeriodEnd);
    expect(eventPublisher.publishUpdated).toHaveBeenCalledTimes(2);
  });
});
