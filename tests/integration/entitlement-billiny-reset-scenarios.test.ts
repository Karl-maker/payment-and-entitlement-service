import { jest } from "@jest/globals";
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

describe("Reset scenarios on billing-cycle renewal", () => {
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

    const entitlementUpdateNotifier: EntitlementUpdateNotifier = {
      notify: (entitlement) =>
        eventPublisher.publishAvailabilityFromEntitlement(entitlement),
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
  it("resets usage on billing-cycle renewal", async () => {
    const userId = `user-renew-${Date.now()}`;
    const productId = `prod-renew-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

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
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [],
      }),
    );

    const entitlementBefore = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementBefore).not.toBeNull();
    entitlementBefore!.usage!.used = 77;
    await entitlementRepo.update(entitlementBefore!);

    await useCase.execute(
      createBillingDomainEvent("subscription.updated", {
        userId,
        productId,
        previousProductId: productId,
        currentPeriodStart: isoDaysFromNow(31),
        currentPeriodEnd: isoDaysFromNow(60),
        addonProductIds: [],
      }),
    );

    const entitlementAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementAfter!.usage!.used).toBe(0);
  });

  it("should reset usage on billing-cycle renewal with addon products and same entitlement keys", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const addonProductId = `addon-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);
    const renewalPeriodEnd = isoDaysFromNow(60);

    await createProduct(productRepo, createdProductIds, {
      productId,
      name: "Base monthly plan",
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 100,
          period: "billing_cycle",
        },
      ],
      addonConfigs: [
        {
          productId: addonProductId,
        } as any,
      ],
    });

    await createProduct(productRepo, createdProductIds, {
      productId: addonProductId,
      name: "Weekly boost add-on",
      entitlements: [EntitlementKey.QUESTION_GENERATION],
      usageLimits: [
        {
          metric: EntitlementKey.QUESTION_GENERATION,
          limit: 25,
          period: "billing_cycle",
        },
      ],
    });

    await useCase.execute(
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [addonProductId],
      }),
    );

    const entitlementBefore = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    //checking the usage first
    expect(entitlementBefore).not.toBeNull();
    expect(entitlementBefore?.usage).toBeDefined();
    expect(entitlementBefore?.usage?.limit).toBe(125);
    expect(entitlementBefore?.usage?.used).toBe(0);

    if (entitlementBefore?.usage) {
      entitlementBefore.usage.used = 42;
      await entitlementRepo.update(entitlementBefore);
    }

    expect(entitlementBefore?.usage?.used).toBe(42);

    await useCase.execute(
      createBillingDomainEvent("subscription.updated", {
        userId,
        productId,
        previousProductId: productId,
        currentPeriodStart: isoDaysFromNow(31),
        currentPeriodEnd: renewalPeriodEnd,
        addonProductIds: [addonProductId],
      }),
    );

    const entitlementAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(entitlementAfter).not.toBeNull();
    expect(entitlementAfter?.usage?.used).toBeDefined();
    expect(entitlementAfter?.usage?.resetStrategy).toBeDefined();
    expect(entitlementAfter?.usage?.used).toBe(0);
    expect(eventPublisher.publishUpdated).toHaveBeenCalled();
  });

  it("when base and add on product have different entitlement keys and reset strategies", async () => {
    const userId = `user-separate-${Date.now()}`;
    const productId = `prod-separate-${Date.now()}`;
    const addonProductId = `addon-separate-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      name: "Base monthly plan",
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      usageLimits: [
        {
          metric: EntitlementKey.SUBJECT_ACCESS,
          limit: 100,
          period: "billing_cycle",
        },
      ],
      addonConfigs: [
        {
          productId: addonProductId,
        } as any,
      ],
    });

    await createProduct(productRepo, createdProductIds, {
      productId: addonProductId,
      name: "Question generation add-on",
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
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [addonProductId],
      }),
    );

    const subjectAccess = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );
    const questionGeneration = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(subjectAccess).not.toBeNull();
    expect(questionGeneration).not.toBeNull();

    expect(subjectAccess?.usage?.limit).toBe(100);
    expect(questionGeneration?.usage?.limit).toBe(25);

    expect(subjectAccess?.usage?.resetStrategy?.period).toBe("billing_cycle");
    expect(questionGeneration?.usage?.resetStrategy?.period).toBe("week");
  });

  it("should reset usage on billing-cycle renewal and addon product remains due to weekly reset", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `prod-${Date.now()}`;
    const addonProductId = `addon-${Date.now()}`;
    const currentPeriodEnd = isoDaysFromNow(30);

    await createProduct(productRepo, createdProductIds, {
      productId,
      name: "Base monthly plan",
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      usageLimits: [
        {
          metric: EntitlementKey.SUBJECT_ACCESS,
          limit: 100,
          period: "billing_cycle",
        },
      ],
      addonConfigs: [
        {
          productId: addonProductId,
        } as any,
      ],
    });

    await createProduct(productRepo, createdProductIds, {
      productId: addonProductId,
      name: "Question add-on",
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
      createBillingDomainEvent("subscription.created", {
        userId,
        productId,
        currentPeriodEnd,
        addonProductIds: [addonProductId],
      }),
    );

    const subjectAccess = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );

    const questionGeneration = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(subjectAccess).not.toBeNull();
    expect(subjectAccess?.usage?.limit).toBe(100);
    expect(subjectAccess?.usage?.used).toBe(0);

    expect(questionGeneration).not.toBeNull();
    expect(questionGeneration?.usage?.limit).toBe(25);
    expect(questionGeneration?.usage?.used).toBe(0);

    subjectAccess!.usage!.used = 77;
    await entitlementRepo.update(subjectAccess!);

    questionGeneration!.usage!.used = 12;
    await entitlementRepo.update(questionGeneration!);

    expect(subjectAccess!.usage!.used).toBe(77);
    expect(questionGeneration!.usage!.used).toBe(12);

    await useCase.execute(
      createBillingDomainEvent("subscription.updated", {
        userId,
        productId,
        previousProductId: productId,
        currentPeriodStart: isoDaysFromNow(31),
        currentPeriodEnd: isoDaysFromNow(60),
        addonProductIds: [addonProductId],
      }),
    );

    await useCase.execute(
      createBillingDomainEvent("subscription.updated", {
        userId,
        productId,
        previousProductId: addonProductId,
        currentPeriodStart: isoDaysFromNow(31),
        currentPeriodEnd: isoDaysFromNow(60),
        addonProductIds: [],
      }),
    );

    const subjectAccessAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );
    const questionGenerationAfter = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.QUESTION_GENERATION,
    );

    expect(subjectAccessAfter).not.toBeNull();
    expect(subjectAccessAfter?.usage?.limit).toBe(100);
    expect(subjectAccessAfter?.usage?.used).toBe(0);
    expect(questionGenerationAfter).not.toBeNull();
    expect(questionGenerationAfter?.usage?.limit).toBe(25);
    expect(questionGenerationAfter?.usage?.used).toBe(12); // weekly add-on should not reset on monthly renewal
    expect(eventPublisher.publishUpdated).toHaveBeenCalledTimes(4);
  });
});
