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

function expectAllRevokedReasonsToBeSubscriptionExpired(
  eventPublisher: EntitlementEventPublisher,
) {
  const revokedCalls = (eventPublisher.publishRevoked as jest.Mock).mock
    .calls as any[];

  for (const call of revokedCalls) {
    expect(call[0].reason).toBe("subscription.expired");
  }
}

type BillingDomainEvent<TPayload = any> =
  BillingEvent.BillingDomainEvent<TPayload>;

describe("subscription expired", () => {
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

  it("should revoke product on subscription.expired", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId: productId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      addonConfigs: [],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId: productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.expired", {
        userId,
        productId: productId,
      }),
    );

    const entitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    expect(entitlement!.status).toBe("revoked");
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(1);
  });

  it("should revoke base product and add-ons on subscription.expired", async () => {
    const userId = `user-${Date.now()}`;
    const baseProductId = `prod-${Date.now()}`;
    const addonProductId = `addon-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId: baseProductId,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      addonConfigs: [{ productId: addonProductId } as any],
    });

    await createProduct(productRepo, createdProductIds, {
      productId: addonProductId,
      entitlements: [EntitlementKey.QUESTION_GENERATION],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId: baseProductId,
        currentPeriodEnd,
        addonProductIds: [addonProductId],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.expired", {
        userId,
        productId: baseProductId,
      }),
    );

    const base = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );
    const addon = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(base!.status).toBe("revoked");
    expect(addon!.status).toBe("revoked");
    expect(eventPublisher.publishRevoked).toHaveBeenCalledTimes(2);
  });
});
