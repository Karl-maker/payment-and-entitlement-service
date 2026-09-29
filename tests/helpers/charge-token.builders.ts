import { jest } from "@jest/globals";
import {
  CreateEntitlementUseCase,
  Entitlement,
  EntitlementKey,
  EntitlementRepository,
  EntitlementRole,
  EntitlementStatus,
  EntitlementUpdateNotifier,
  EntitlementUsage,
  Product,
  ProductRepositoryPorts,
  Price,
  PriceRepository,
  BillingType,
  ProductType,
  SyncProductLimitsToEntitlementsUseCase,
} from "@libs/domain";
import { ChargeTokenUseCase } from "../../services/token-service/src/app/usecases/charge.token.usecase";
import {
  DEFAULT_GRANTED_AT,
  DEFAULT_PRODUCT_ID,
  DEFAULT_USER_ID,
} from "./charge-token.fixtures";

export type ChargeTokenDeps = {
  useCase: ChargeTokenUseCase;
  entitlementRepo: {
    findByUserAndKey: jest.MockedFunction<
      (userId: string, entitlementKey: string) => Promise<Entitlement | null>
    >;
    findByUser: jest.MockedFunction<(userId: string) => Promise<Entitlement[]>>;
    save: jest.MockedFunction<(entitlement: Entitlement) => Promise<void>>;
    update: jest.MockedFunction<(entitlement: Entitlement) => Promise<void>>;
    deleteAll: jest.MockedFunction<() => Promise<{ deleted: number }>>;
    deleteByUserAndKey: jest.MockedFunction<
      (userId: string, entitlementKey: string) => Promise<boolean>
    >;
  };
  priceRepo: {
    findById: jest.MockedFunction<(priceId: string) => Promise<Price | null>>;
  };
  productRepo: {
    findById: jest.MockedFunction<
      (productId: string) => Promise<Product | null>
    >;
  };
  createEntitlementUseCase: {
    execute: jest.MockedFunction<
      (input: {
        userId: string;
        key: EntitlementKey;
        role: EntitlementRole;
        expiresAt?: Date;
      }) => Promise<void>
    >;
  };
  syncProductLimitsUseCase: {
    execute: jest.MockedFunction<
      (input: {
        productId: string;
        userId: string;
        isAddon?: boolean;
        isOneTimePayment?: boolean;
      }) => Promise<void>
    >;
  };
  notifier: {
    notify: jest.MockedFunction<(entitlement: Entitlement) => Promise<void>>;
  };
  processedTokenChargesRepo: {
    getCachedResponse: jest.MockedFunction<
      (idempotencyKey: string) => Promise<any>
    >;
    saveCachedResponse: jest.MockedFunction<
      (idempotencyKey: string, response: unknown) => Promise<void>
    >;
    canCharge: jest.MockedFunction<(userId: string) => Promise<boolean>>;
    recordCharge: jest.MockedFunction<(userId: string) => Promise<void>>;
  };
  entitlementStore: Map<string, Entitlement>;
};

function storeKey(userId: string, key: string): string {
  return `${userId}::${key}`;
}

export function buildPrice({
  priceId = "price_1",
  productId = DEFAULT_PRODUCT_ID,
  amount = 50,
  currency = "token",
}: {
  priceId?: string;
  productId?: string;
  amount?: number;
  currency?: string;
} = {}): Price {
  return Price.create({
    priceId,
    productId,
    billingType: BillingType.ONE_TIME,
    amount,
    currency,
  });
}

export function buildProduct({
  productId = DEFAULT_PRODUCT_ID,
  entitlements = [EntitlementKey.SUBJECT_ACCESS],
  usageLimits = [],
}: {
  productId?: string;
  entitlements?: EntitlementKey[];
  usageLimits?: Product["usageLimits"];
} = {}): Product {
  return Product.create({
    productId,
    name: "Token Product",
    type: ProductType.ONE_OFF,
    entitlements,
    usageLimits,
    isActive: true,
  });
}

export function buildTokenEntitlement({
  userId = DEFAULT_USER_ID,
  limit = 100,
  used = 20,
  permanentLimit = 0,
  resetAt,
}: {
  userId?: string;
  limit?: number;
  used?: number;
  permanentLimit?: number;
  resetAt?: Date;
} = {}): Entitlement {
  return new Entitlement(
    userId,
    "token" as EntitlementKey,
    "learner" as EntitlementRole,
    EntitlementStatus.ACTIVE,
    DEFAULT_GRANTED_AT,
    undefined,
    new EntitlementUsage(limit, used, resetAt, undefined, permanentLimit),
  );
}

export function buildExistingProductEntitlement({
  userId = DEFAULT_USER_ID,
  key = EntitlementKey.SUBJECT_ACCESS,
  status = EntitlementStatus.REVOKED,
}: {
  userId?: string;
  key?: EntitlementKey;
  status?: EntitlementStatus;
} = {}): Entitlement {
  return new Entitlement(
    userId,
    key,
    "learner" as EntitlementRole,
    status,
    DEFAULT_GRANTED_AT,
  );
}

export function buildChargeTokenUseCase(): ChargeTokenDeps {
  const entitlementStore = new Map<string, Entitlement>();

  const entitlementRepo = {
    findByUserAndKey: jest.fn(
      async (userId: string, entitlementKey: string) => {
        return entitlementStore.get(storeKey(userId, entitlementKey)) ?? null;
      },
    ),
    findByUser: jest.fn(async (userId: string) => {
      return [...entitlementStore.values()].filter(
        (entitlement) => entitlement.userId === userId,
      );
    }),
    save: jest.fn(async (entitlement: Entitlement) => {
      entitlementStore.set(
        storeKey(entitlement.userId, entitlement.key),
        entitlement,
      );
    }),
    update: jest.fn(async (entitlement: Entitlement) => {
      entitlementStore.set(
        storeKey(entitlement.userId, entitlement.key),
        entitlement,
      );
    }),
    deleteAll: jest.fn(),
    deleteByUserAndKey: jest.fn(
      async (userId: string, entitlementKey: string) => {
        return entitlementStore.delete(storeKey(userId, entitlementKey));
      },
    ),
  } as unknown as ChargeTokenDeps["entitlementRepo"] & EntitlementRepository;

  const priceRepo = {
    findById: jest.fn(),
  } as unknown as ChargeTokenDeps["priceRepo"] & PriceRepository;

  const productRepo = {
    findById: jest.fn(),
  } as unknown as ChargeTokenDeps["productRepo"] &
    ProductRepositoryPorts.ProductRepository;

  const processedTokenChargesRepo = {
    getCachedResponse: jest.fn(),
    saveCachedResponse: jest.fn(),
    canCharge: jest.fn(),
    recordCharge: jest.fn(),
  } as unknown as ChargeTokenDeps["processedTokenChargesRepo"];
  processedTokenChargesRepo.getCachedResponse.mockResolvedValue(null);
  processedTokenChargesRepo.saveCachedResponse.mockResolvedValue(undefined);
  processedTokenChargesRepo.canCharge.mockResolvedValue(true);
  processedTokenChargesRepo.recordCharge.mockResolvedValue(undefined);

  const createEntitlementUseCase = {
    execute: jest.fn(async ({ userId, key, role, expiresAt }: any) => {
      const entitlement = new Entitlement(
        userId,
        key,
        role,
        EntitlementStatus.ACTIVE,
        DEFAULT_GRANTED_AT,
        expiresAt,
      );
      entitlementStore.set(storeKey(userId, key), entitlement);
    }),
  } as unknown as ChargeTokenDeps["createEntitlementUseCase"] &
    CreateEntitlementUseCase;

  const syncProductLimitsUseCase = {
    execute: jest.fn(async () => undefined),
  } as unknown as ChargeTokenDeps["syncProductLimitsUseCase"] &
    SyncProductLimitsToEntitlementsUseCase;

  const notifier = {
    notify: jest.fn(async () => undefined),
  } as unknown as ChargeTokenDeps["notifier"] & EntitlementUpdateNotifier;

  const useCase = new ChargeTokenUseCase(
    entitlementRepo,
    priceRepo,
    productRepo,
    createEntitlementUseCase,
    syncProductLimitsUseCase,
    notifier,
    processedTokenChargesRepo,
  );

  return {
    useCase,
    entitlementRepo,
    priceRepo,
    productRepo,
    createEntitlementUseCase,
    syncProductLimitsUseCase,
    notifier,
    processedTokenChargesRepo,
    entitlementStore,
  };
}
