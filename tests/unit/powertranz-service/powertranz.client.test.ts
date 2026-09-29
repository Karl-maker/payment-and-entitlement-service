import { PowerTranzClient } from "../../../services/powertranz-service/src/infrastructure/powertranz.client";

describe("PowerTranzClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates an Auth SPI token using the auth endpoint", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        SpiToken: "spi_123",
        RedirectData: "<form>redirect</form>",
        TransactionIdentifier: "txn_123",
        OrderIdentifier: "order_123",
      }),
    });

    const client = new PowerTranzClient(
      "https://staging.ptranz.com",
      fetchImpl as any,
      "merchant_123",
      "password_123",
    );

    const result = await client.createAuthSpiToken({
      TransactionIdentifier: "txn_123",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://staging.ptranz.com/Api/spi/Auth",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ TransactionIdentifier: "txn_123" }),
      }),
    );
    expect(result).toEqual({
      spiToken: "spi_123",
      redirectData: "<form>redirect</form>",
      hostedPaymentPageHtml: "<form>redirect</form>",
      transactionIdentifier: "txn_123",
      orderIdentifier: "order_123",
    });
  });

  it("logs request and response details with secrets redacted", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        SpiToken: "spi_123",
        RedirectData: "<form>redirect</form>",
      }),
    });
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    const client = new PowerTranzClient(
      "https://staging.ptranz.com",
      fetchImpl as any,
      "merchant_123",
      "password_123",
    );

    await client.createAuthSpiToken({
      TransactionIdentifier: "txn_123",
      ExtendedData: {
        MerchantResponseUrl:
          "https://example.test/powertranz/callback?secret=super-secret",
      },
    });

    expect(infoSpy).toHaveBeenNthCalledWith(
      1,
      "[PowerTranzClient] request",
      expect.objectContaining({
        operation: "auth",
        url: "https://staging.ptranz.com/Api/spi/Auth",
        method: "POST",
        headers: expect.objectContaining({
          "PowerTranz-PowerTranzId": "merchant_123",
          "PowerTranz-PowerTranzPassword": "[REDACTED]",
        }),
        body: expect.objectContaining({
          ExtendedData: expect.objectContaining({
            MerchantResponseUrl:
              "https://example.test/powertranz/callback?secret=[REDACTED]",
          }),
        }),
      }),
    );

    expect(infoSpy).toHaveBeenNthCalledWith(
      2,
      "[PowerTranzClient] response",
      expect.objectContaining({
        operation: "auth",
        url: "https://staging.ptranz.com/Api/spi/Auth",
        status: 200,
        ok: true,
      }),
    );
  });

  it("rejects an auth response when preprocessing does not return SP4", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        IsoResponseCode: "12",
        ResponseMessage: "Invalid transaction",
      }),
    });

    const client = new PowerTranzClient(
      "https://staging.ptranz.com",
      fetchImpl as any,
      "merchant_123",
      "password_123",
    );

    await expect(
      client.createAuthSpiToken({ TransactionIdentifier: "txn_123" }),
    ).rejects.toThrow("PowerTranz auth response not approved: 12 Invalid transaction");
  });

  it("posts the JSON stringified SPI token when completing payment", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        IsoResponseCode: "00",
        ResponseMessage: "Transaction is approved.",
      }),
    });

    const client = new PowerTranzClient(
      "https://staging.ptranz.com",
      fetchImpl as any,
      "merchant_123",
      "password_123",
    );

    await client.chargePayment("spi_123");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://staging.ptranz.com/api/spi/payment",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "PowerTranz-PowerTranzId": "merchant_123",
          "PowerTranz-PowerTranzPassword": "password_123",
        }),
        body: JSON.stringify("spi_123"),
      }),
    );
  });
});
