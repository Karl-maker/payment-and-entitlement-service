import {
  SyncProductLimitsToEntitlementsUseCase,
  Product,
  ProductType,
  Entitlement,
  EntitlementUsage,
  EntitlementStatus,
  EntitlementKey,
} from "@libs/domain";
import type { EntitlementRepository } from "@libs/domain";
import type { ProductRepository } from "@libs/domain/src/products/app/ports/product.repository.port";

describe("SyncProductLimitsToEntitlementsUseCase with notifier", () => {
  it("should call notifier with updated entitlement after repo.update", async () => {
    const product = Product.create({
      productId: "prod-1",
      name: "Test Product",
      type: ProductType.SUBSCRIPTION,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      isActive: true,
      usageLimits: [{ metric: EntitlementKey.SUBJECT_ACCESS, limit: 50, period: "month" }],
    });

    const usage = new EntitlementUsage(10, 2); // limit 10, used 2
    const entitlement = new Entitlement(
      "user-1",
      EntitlementKey.SUBJECT_ACCESS,
      "learner",
      EntitlementStatus.ACTIVE,
      new Date(),
      undefined,
      usage
    );

    const notified: Entitlement[] = [];
    const notifier = {
      notify: async (e: Entitlement) => {
        notified.push(e);
      },
    };

    const productRepo: ProductRepository = {
      findById: async () => product,
      create: async () => {},
      update: async () => {},
      delete: async () => {},
      list: async () => ({ items: [], total: 0, pageNumber: 1, pageSize: 10 }),
    };

    const entitlementRepo: EntitlementRepository = {
      findByUser: async () => [entitlement],
      findByUserAndKey: async () => null,
      save: async () => {},
      update: async () => {},
      deleteAll: async () => ({ deleted: 0 }),
      deleteByUserAndKey: async () => false,
    };

    const useCase = new SyncProductLimitsToEntitlementsUseCase(
      productRepo,
      entitlementRepo,
      notifier
    );

    await useCase.execute({ productId: "prod-1", userId: "user-1" });

    expect(notified.length).toBe(1);
    expect(notified[0].userId).toBe("user-1");
    expect(notified[0].key).toBe(EntitlementKey.SUBJECT_ACCESS);
    expect(notified[0].usage?.limit).toBe(50); // overwritten by sync
  });
});
