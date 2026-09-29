import { jest } from "@jest/globals";
import {
  Entitlement,
  EntitlementKey,
  EntitlementStatus,
  EntitlementUsage,
} from "@libs/domain";
import {
  buildChargeTokenUseCase,
  buildExistingProductEntitlement,
  buildPrice,
  buildProduct,
  buildTokenEntitlement,
} from "../helpers/charge-token.builders";

describe("ChargeTokenUseCase", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("charges tokens and grants access immediately", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 30, currency: "token" });
    const product = buildProduct({
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 20 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);
    chargeToken.entitlementStore.set(
      `user_1::${EntitlementKey.SUBJECT_ACCESS}`,
      buildExistingProductEntitlement({
        key: EntitlementKey.SUBJECT_ACCESS,
        status: EntitlementStatus.REVOKED,
      }),
    );

    const result = await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(result.success).toBe(true);
    expect(result.amount).toBe(30);
    expect(result.remainingTokens).toBe(50);
    expect(result.paymentIntentId).toContain("token_");

    expect(chargeToken.entitlementRepo.update).toHaveBeenCalled();
    expect(chargeToken.syncProductLimitsUseCase.execute).toHaveBeenCalledWith({
      productId: product.productId,
      userId: "user_1",
      isAddon: false,
      isOneTimePayment: true,
    });
    expect(chargeToken.notifier.notify).toHaveBeenCalled();
    expect(tokenEntitlement.usage?.used).toBe(50);
  });

  it("creates missing product entitlements", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 10 });
    const product = buildProduct({
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 10 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(chargeToken.createEntitlementUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        key: EntitlementKey.SUBJECT_ACCESS,
        role: "learner",
        expiresAt: undefined,
      }),
    );
  });

  it("activates existing product entitlement", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 10 });
    const product = buildProduct({
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
    });
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 10 });
    const existing = buildExistingProductEntitlement({
      key: EntitlementKey.SUBJECT_ACCESS,
      status: EntitlementStatus.REVOKED,
    });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);
    chargeToken.entitlementStore.set(
      `user_1::${EntitlementKey.SUBJECT_ACCESS}`,
      existing,
    );

    await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(existing.status).toBe(EntitlementStatus.ACTIVE);
    expect(chargeToken.entitlementRepo.update).toHaveBeenCalledWith(existing);
    expect(chargeToken.createEntitlementUseCase.execute).not.toHaveBeenCalled();
  });

  it("throws if price is missing", async () => {
    const chargeToken = buildChargeTokenUseCase();
    chargeToken.priceRepo.findById.mockResolvedValue(null);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: "missing_price",
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Price 'missing_price' not found",
    });
  });

  it("throws if currency is not token", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ currency: "usd" });

    chargeToken.priceRepo.findById.mockResolvedValue(price);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "DomainError",
      message: expect.stringContaining("does not use token currency"),
    });
  });

  it("throws if product is missing", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ productId: "missing_product" });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(null);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Product 'missing_product' not found",
    });
  });

  it("throws if token entitlement is missing", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice();
    const product = buildProduct();

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Token entitlement not found for user 'user_1'",
    });
  });

  it("throws if token entitlement is inactive", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice();
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement();

    tokenEntitlement.status = EntitlementStatus.REVOKED;

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "DomainError",
      message: expect.stringContaining("not active"),
    });
  });

  it("throws if token entitlement is not usage-based", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice();
    const product = buildProduct();
    const tokenEntitlement = new Entitlement(
      "user_1",
      "token" as EntitlementKey,
      "learner",
      EntitlementStatus.ACTIVE,
      new Date("2026-05-21T00:00:00.000Z"),
    );

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "DomainError",
      message: expect.stringContaining("not usage-based"),
    });
  });

  it("resets token usage when reset is due", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 10 });
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement({
      limit: 100,
      used: 80,
      resetAt: new Date(Date.now() - 60_000),
    });

    tokenEntitlement.usage!.resetStrategy = {
      type: "periodic",
      period: "day",
      hour: 0,
    };

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    const result = await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(result.amount).toBe(10);
    expect(tokenEntitlement.usage?.used).toBe(10);
    expect(chargeToken.entitlementRepo.update).toHaveBeenCalledTimes(2);
    expect(chargeToken.notifier.notify).toHaveBeenCalledTimes(2);
    expect(chargeToken.entitlementRepo.findByUserAndKey).toHaveBeenCalledWith(
      "user_1",
      "token",
    );
  });

  it("throws if tokens are insufficient", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 500 });
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 20 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
      }),
    ).rejects.toMatchObject({
      name: "DomainError",
      code: "INSUFFICIENT_FUNDS",
      message: expect.stringContaining("Insufficient tokens"),
    });
  });

  it("returns the updated remaining balance", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 25 });
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 30 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    const result = await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(result.remainingTokens).toBe(45);
    expect(tokenEntitlement.usage?.used).toBe(55);
  });

  it("notifies after decrement on a successful charge", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const price = buildPrice({ amount: 15 });
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 40 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: price.priceId,
    });

    expect(chargeToken.notifier.notify).toHaveBeenCalledTimes(1);
    expect(chargeToken.notifier.notify).toHaveBeenCalledWith(tokenEntitlement);
  });

  it("returns a cached response for the same idempotency key", async () => {
    const chargeToken = buildChargeTokenUseCase();
    const cached = {
      success: true,
      paymentIntentId: "token_123",
      amount: 30,
      remainingTokens: 50,
    };

    chargeToken.processedTokenChargesRepo.getCachedResponse.mockResolvedValue(
      cached,
    );

    const result = await chargeToken.useCase.execute({
      userId: "user_1",
      priceId: "price_1",
      idempotencyKey: "idem-123",
    });

    expect(result).toEqual(cached);
    expect(chargeToken.priceRepo.findById).not.toHaveBeenCalled();
  });

  it("throws RATE_LIMITED when the user is charging too frequently", async () => {
    const chargeToken = buildChargeTokenUseCase();
    chargeToken.processedTokenChargesRepo.getCachedResponse.mockResolvedValue(
      null,
    );
    chargeToken.processedTokenChargesRepo.canCharge.mockResolvedValue(false);

    const price = buildPrice({ amount: 10 });
    const product = buildProduct();
    const tokenEntitlement = buildTokenEntitlement({ limit: 100, used: 20 });

    chargeToken.priceRepo.findById.mockResolvedValue(price);
    chargeToken.productRepo.findById.mockResolvedValue(product);
    chargeToken.entitlementStore.set("user_1::token", tokenEntitlement);

    await expect(
      chargeToken.useCase.execute({
        userId: "user_1",
        priceId: price.priceId,
        idempotencyKey: "idem-123",
      }),
    ).rejects.toMatchObject({
      name: "DomainError",
      code: "RATE_LIMITED",
    });
  });
});
