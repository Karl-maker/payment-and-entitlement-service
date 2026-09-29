import { Product, ProductType, EntitlementKey } from "@libs/domain";

describe("Product Entity", () => {
  function makeProduct(
    overrides?: Partial<Parameters<typeof Product.create>[0]>,
  ) {
    return Product.create({
      productId: "prod-001",
      name: "Pro Plan",
      description: "Full access subscription",
      type: ProductType.SUBSCRIPTION,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      isActive: true,
      ...overrides,
    });
  }

  describe("create", () => {
    it("should create a product with valid properties", () => {
      const product = makeProduct();

      expect(product.productId).toBe("prod-001");
      expect(product.name).toBe("Pro Plan");
      expect(product.type).toBe(ProductType.SUBSCRIPTION);
      expect(product.entitlements).toContain(EntitlementKey.SUBJECT_ACCESS);
      expect(product.isActive).toBe(true);
      expect(product.createdAt).toBeInstanceOf(Date);
      expect(product.updatedAt).toBeInstanceOf(Date);
    });

    it("should default addons and usageLimits to empty arrays", () => {
      const product = makeProduct();

      expect(product.addons).toEqual([]);
      expect(product.usageLimits).toEqual([]);
      expect(product.addonConfigs).toEqual([]);
    });

    it("should default providers to empty object", () => {
      const product = makeProduct();
      expect(product.providers).toEqual({});
    });

    it("should reject usage limits that do not match entitlements", () => {
      expect(() =>
        makeProduct({
          entitlements: [EntitlementKey.SUBJECT_ACCESS],
          usageLimits: [
            {
              metric: "unknown_metric",
              limit: 10,
              period: "month",
            },
          ],
        }),
      ).toThrow(
        "Usage limits must match entitlements. Invalid metrics: unknown_metric",
      );
    });
  });

  describe("behavior", () => {
    it("should rename a product", () => {
      const product = makeProduct();
      product.rename("Enterprise Plan");
      expect(product.name).toBe("Enterprise Plan");
    });

    it("should activate and deactivate", () => {
      const product = makeProduct({ isActive: false });
      expect(product.isActive).toBe(false);

      product.activate();
      expect(product.isActive).toBe(true);

      product.deactivate();
      expect(product.isActive).toBe(false);
    });

    it("should add an entitlement", () => {
      const product = makeProduct();
      product.addEntitlement(EntitlementKey.AI_TUTOR_ACCESS);
      expect(product.entitlements).toContain(EntitlementKey.AI_TUTOR_ACCESS);
      expect(product.entitlements).toContain(EntitlementKey.SUBJECT_ACCESS);
    });

    it("should remove an entitlement", () => {
      const product = makeProduct({
        entitlements: [
          EntitlementKey.SUBJECT_ACCESS,
          EntitlementKey.AI_TUTOR_ACCESS,
        ],
      });
      product.removeEntitlement(EntitlementKey.AI_TUTOR_ACCESS);
      expect(product.entitlements).not.toContain(
        EntitlementKey.AI_TUTOR_ACCESS,
      );
      expect(product.entitlements).toContain(EntitlementKey.SUBJECT_ACCESS);
    });

    it("should add a provider", () => {
      const product = makeProduct();
      product.addProvider("stripe", "prod_stripe_123");
      expect(product.providers.stripe).toBe("prod_stripe_123");
    });

    it("should remove a provider", () => {
      const product = makeProduct();
      product.addProvider("stripe", "prod_stripe_123");
      product.removeProvider("stripe");
      expect(product.providers.stripe).toBeUndefined();
    });

    it("should reject usage limits that do not match entitlements", () => {
      expect(() =>
        makeProduct({
          entitlements: [EntitlementKey.SUBJECT_ACCESS],
          usageLimits: [
            {
              metric: "unknown_metric",
              limit: 10,
              period: "month",
            },
          ],
        }),
      ).toThrow(
        "Usage limits must match entitlements. Invalid metrics: unknown_metric",
      );
    });

    it("should reject usage limits whose metric is not in entitlements", () => {
      const product = makeProduct({
        entitlements: [EntitlementKey.SUBJECT_ACCESS],
        usageLimits: [],
      });

      expect(() =>
        product.addUsageLimit({
          metric: "nonexistent_entitlement",
          limit: 10,
          period: "month",
        }),
      ).toThrow(
        "Usage limit metric 'nonexistent_entitlement' must match one of the product entitlements",
      );
    });
  });
});
