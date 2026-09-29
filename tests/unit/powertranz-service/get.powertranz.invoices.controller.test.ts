import { GetPowerTranzInvoicesController } from "../../../services/powertranz-service/src/app/controllers/get.powertranz.invoices.controller";

describe("GetPowerTranzInvoicesController", () => {
  function buildController() {
    const useCase = {
      execute: jest.fn().mockResolvedValue([
        {
          id: "invoice_1",
          userId: "user_1",
          priceId: "price_1",
          productId: "product_1",
          spiToken: "spi_123",
          amount: 999,
          currency: "USD",
          status: "completed",
          expiresAt: "2026-08-05T10:05:00.000Z",
          createdAt: "2026-08-05T10:00:00.000Z",
          paidAt: "2026-08-05T10:01:00.000Z",
          transactionId: "txn_123",
          orderIdentifier: "POWERTRANZ-txn_123",
          approved: true,
          isoResponseCode: "00",
          responseMessage: "Approved",
          cardBrand: "Visa",
          transactionType: 2,
        },
      ]),
    };

    return {
      controller: new GetPowerTranzInvoicesController(useCase as any),
      useCase,
    };
  }

  it("returns authenticated user's PowerTranz invoices with payment timing fields", async () => {
    const { controller, useCase } = buildController();

    const result = await controller.handle({
      method: "GET",
      path: "/powertranz/invoices",
      pathParams: {},
      query: {
        status: "completed",
        spiToken: "spi_123",
      },
      body: null,
      user: {
        id: "user_1",
        role: "USER",
      },
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      userId: "user_1",
      limit: undefined,
      status: "completed",
      spiToken: "spi_123",
      transactionIdentifier: undefined,
      orderIdentifier: undefined,
    });

    expect(result).toEqual({
      userId: "user_1",
      invoices: [
        {
          invoiceId: "invoice_1",
          provider: "powertranz",
          spiToken: "spi_123",
          transactionIdentifier: "txn_123",
          orderIdentifier: "POWERTRANZ-txn_123",
          amount: 999,
          currency: "USD",
          priceId: "price_1",
          productId: "product_1",
          status: "completed",
          createdAt: "2026-08-05T10:00:00.000Z",
          expiresAt: "2026-08-05T10:05:00.000Z",
          paidAt: "2026-08-05T10:01:00.000Z",
          paymentTime: "2026-08-05T10:01:00.000Z",
          failedAt: null,
          lastCallbackAt: null,
          approved: true,
          isoResponseCode: "00",
          responseMessage: "Approved",
          cardBrand: "Visa",
          transactionType: 2,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      ],
      count: 1,
    });
  });
});
