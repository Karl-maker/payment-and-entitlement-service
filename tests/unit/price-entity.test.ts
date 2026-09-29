import { Price, BillingType, Interval } from "@libs/domain";

describe("Price Entity", () => {
  function makePrice(overrides?: Partial<Parameters<typeof Price.create>[0]>) {
    return Price.create({
      priceId: "price-001",
      productId: "prod-001",
      billingType: BillingType.RECURRING,
      interval: Interval.MONTH,
      frequency: 1,
      amount: 999,
      currency: "USD",
      ...overrides,
    });
  }

  describe("create", () => {
    it("should create a recurring price", () => {
      const price = makePrice();

      expect(price.priceId).toBe("price-001");
      expect(price.productId).toBe("prod-001");
      expect(price.billingType).toBe(BillingType.RECURRING);
      expect(price.interval).toBe(Interval.MONTH);
      expect(price.amount).toBe(999);
      expect(price.currency).toBe("USD");
      expect(price.createdAt).toBeInstanceOf(Date);
    });

    it("should create a one-time price without interval", () => {
      const price = makePrice({
        billingType: BillingType.ONE_TIME,
        interval: undefined,
      });

      expect(price.billingType).toBe(BillingType.ONE_TIME);
      expect(price.interval).toBeUndefined();
    });

    it("should default providers to empty object", () => {
      const price = makePrice();
      expect(price.providers).toEqual({});
    });

    it("should default frequency to 1", () => {
      const price = makePrice();
      expect(price.frequency).toBe(1);
    });
  });

  describe("behavior", () => {
    it("should update amount", () => {
      const price = makePrice();
      price.updateAmount(1999);
      expect(price.amount).toBe(1999);
    });

    it("should update currency", () => {
      const price = makePrice();
      price.updateCurrency("EUR");
      expect(price.currency).toBe("EUR");
    });

    it("should add a provider", () => {
      const price = makePrice();
      price.addProvider("stripe", "price_stripe_123");
      expect(price.providers.stripe).toBe("price_stripe_123");
    });

    it("should remove a provider", () => {
      const price = makePrice();
      price.addProvider("stripe", "price_stripe_123");
      price.removeProvider("stripe");
      expect(price.providers.stripe).toBeUndefined();
    });
  });
});
