import {
  BillingType,
  ProductType,
} from "@libs/domain";

describe("CreatePaymentIntentUseCase", () => {
  let CreatePaymentIntentUseCase: typeof import("../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase").CreatePaymentIntentUseCase;

  beforeAll(async () => {
    process.env.POWERTRANZ_MERCHANT_RESPONSE_URL =
      "https://example.test/powertranz/callback";
    process.env.USD_TTD_EXCHANGE_RATE = "6.8";
    process.env.POWERTRANZ_3DS_ENABLED = "true";
    delete process.env.POWERTRANZ_HPP_PAGE_SET;
    delete process.env.POWERTRANZ_HPP_PAGE_NAME;

    const mod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    CreatePaymentIntentUseCase = mod.CreatePaymentIntentUseCase;
  });

  const price = {
    priceId: "price_1",
    productId: "product_1",
    billingType: BillingType.ONE_TIME,
    interval: undefined,
    frequency: undefined,
    amount: 19.99,
    currency: "USD",
    providers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const product = {
    productId: "product_1",
    name: "Practice Exam",
    description: "One-time purchase",
    type: ProductType.ONE_OFF,
    entitlements: [],
    usageLimits: {},
    addons: [],
    providers: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function buildUseCase() {
    const getPriceUseCase = {
      execute: jest.fn().mockResolvedValue(price),
    };
    const getProductUseCase = {
      execute: jest.fn().mockResolvedValue(product),
    };
    const powerTranzClient = {
      createAuthSpiToken: jest.fn().mockResolvedValue({
        spiToken: "spi_123",
        redirectData: "<form>redirect</form>",
        hostedPaymentPageHtml: "<form>redirect</form>",
        transactionIdentifier: "txn_123",
        orderIdentifier: "txn_123",
      }),
    };
    const paymentIntentRepo = {
      save: jest.fn().mockResolvedValue(undefined),
    };

    return {
      useCase: new CreatePaymentIntentUseCase(
        getPriceUseCase as any,
        getProductUseCase as any,
        powerTranzClient as any,
        paymentIntentRepo as any,
      ),
      powerTranzClient,
      paymentIntentRepo,
    };
  }

  it("creates a hosted-page Auth request for TTD", async () => {
    const { useCase, powerTranzClient, paymentIntentRepo } = buildUseCase();

    const result = await useCase.execute({
      userId: "user_1",
      userEmail: "buyer@example.com",
      priceId: "price_1",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        TotalAmount: 135.93,
        CurrencyCode: "780",
        ThreeDSecure: true,
        ExtendedData: expect.objectContaining({
          MerchantResponseUrl: "https://example.test/powertranz/callback",
          ThreeDSecure: {
            ChallengeWindowSize: 4,
            ChallengeIndicator: "01",
          },
          HostedPage: {
            PageSet: "PTZ/Payment",
            PageName: "Eislett",
          },
        }),
      }),
    );
    expect(paymentIntentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        spiToken: "spi_123",
        amount: 135.93,
        currency: "TTD",
        transactionId: "txn_123",
        orderIdentifier: "txn_123",
        status: "pending_payment",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        redirectData: "<form>redirect</form>",
        hostedPaymentPageHtml: "<form>redirect</form>",
        spiToken: "spi_123",
        amount: 135.93,
        currency: "TTD",
      }),
    );
  });

  it("uses the explicitly configured hosted page when specified", async () => {
    process.env.POWERTRANZ_HPP_PAGE_SET = "Checkout";
    process.env.POWERTRANZ_HPP_PAGE_NAME = "SchoolPay";

    jest.resetModules();
    const mod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    const ExplicitCreatePaymentIntentUseCase = mod.CreatePaymentIntentUseCase;

    const powerTranzClient = {
      createAuthSpiToken: jest.fn().mockResolvedValue({
        spiToken: "spi_123",
      }),
    };

    const useCase = new ExplicitCreatePaymentIntentUseCase(
      { execute: jest.fn().mockResolvedValue(price) } as any,
      { execute: jest.fn().mockResolvedValue(product) } as any,
      powerTranzClient as any,
      { save: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await useCase.execute({
      userId: "user_1",
      userEmail: "buyer@example.com",
      priceId: "price_1",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ExtendedData: expect.objectContaining({
          HostedPage: {
            PageSet: "PTZ/Checkout",
            PageName: "SchoolPay",
          },
        }),
      }),
    );

    delete process.env.POWERTRANZ_HPP_PAGE_SET;
    delete process.env.POWERTRANZ_HPP_PAGE_NAME;
    process.env.POWERTRANZ_3DS_ENABLED = "true";
    jest.resetModules();
    const resetMod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    CreatePaymentIntentUseCase = resetMod.CreatePaymentIntentUseCase;
  });

  it("omits 3DS settings when 3DS is disabled", async () => {
    process.env.POWERTRANZ_3DS_ENABLED = "false";

    jest.resetModules();
    const mod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    const NonThreeDsCreatePaymentIntentUseCase = mod.CreatePaymentIntentUseCase;

    const powerTranzClient = {
      createAuthSpiToken: jest.fn().mockResolvedValue({
        spiToken: "spi_123",
      }),
    };

    const useCase = new NonThreeDsCreatePaymentIntentUseCase(
      { execute: jest.fn().mockResolvedValue(price) } as any,
      { execute: jest.fn().mockResolvedValue(product) } as any,
      powerTranzClient as any,
      { save: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await useCase.execute({
      userId: "user_1",
      priceId: "price_1",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ThreeDSecure: false,
        ExtendedData: expect.objectContaining({
          MerchantResponseUrl: "https://example.test/powertranz/callback",
          HostedPage: {
            PageSet: "PTZ/Payment",
            PageName: "Eislett",
          },
        }),
      }),
    );

    expect(
      powerTranzClient.createAuthSpiToken.mock.calls[0][0].ExtendedData.ThreeDSecure,
    ).toBeUndefined();

    process.env.POWERTRANZ_3DS_ENABLED = "true";
    jest.resetModules();
    const resetMod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    CreatePaymentIntentUseCase = resetMod.CreatePaymentIntentUseCase;
  });

  it("disables 3DS for debit even when 3DS is globally enabled", async () => {
    process.env.POWERTRANZ_3DS_ENABLED = "true";
    jest.resetModules();

    const mod = await import(
      "../../../services/powertranz-service/src/app/usecases/create.payment.intent.usecase"
    );
    const DebitCreatePaymentIntentUseCase = mod.CreatePaymentIntentUseCase;

    const powerTranzClient = {
      createAuthSpiToken: jest.fn().mockResolvedValue({
        spiToken: "spi_123",
      }),
    };

    const useCase = new DebitCreatePaymentIntentUseCase(
      { execute: jest.fn().mockResolvedValue(price) } as any,
      { execute: jest.fn().mockResolvedValue(product) } as any,
      powerTranzClient as any,
      { save: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await useCase.execute({
      userId: "user_1",
      priceId: "price_1",
      cardType: "debit",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ThreeDSecure: false,
      }),
    );
    expect(
      powerTranzClient.createAuthSpiToken.mock.calls[0][0].ExtendedData.ThreeDSecure,
    ).toBeUndefined();
  });

  it("uses 3DS for credit when 3DS is globally enabled", async () => {
    const { useCase, powerTranzClient } = buildUseCase();

    await useCase.execute({
      userId: "user_1",
      priceId: "price_1",
      cardType: "credit",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ThreeDSecure: true,
        ExtendedData: expect.objectContaining({
          ThreeDSecure: {
            ChallengeWindowSize: 4,
            ChallengeIndicator: "01",
          },
        }),
      }),
    );
  });

  it("forces PowerTranz requests to use TTD even when the source price currency differs", async () => {
    const { useCase } = buildUseCase();
    const result = await useCase.execute({ userId: "user_1", priceId: "price_1" });
    expect(result.amount).toBe(135.93);
    expect(result.currency).toBe("TTD");
  });

  it("leaves TTD amounts unchanged", async () => {
    const ttdPrice = {
      ...price,
      amount: 6.8,
      currency: "TTD",
    };
    const powerTranzClient = {
      createAuthSpiToken: jest.fn().mockResolvedValue({
        spiToken: "spi_123",
      }),
    };

    const useCase = new CreatePaymentIntentUseCase(
      { execute: jest.fn().mockResolvedValue(ttdPrice) } as any,
      { execute: jest.fn().mockResolvedValue(product) } as any,
      powerTranzClient as any,
      { save: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const result = await useCase.execute({
      userId: "user_1",
      priceId: "price_1",
    });

    expect(powerTranzClient.createAuthSpiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        TotalAmount: 6.8,
      }),
    );
    expect(result.amount).toBe(6.8);
    expect(result.currency).toBe("TTD");
  });
});
