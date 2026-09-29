import { GetUserTransactionsController } from "../../../services/transaction-service/src/app/controllers/get.user.transactions.controller";

describe("GetUserTransactionsController", () => {
  it("passes provider filtering to the use case and returns provider in the response", async () => {
    const execute = jest.fn().mockResolvedValue({
      items: [
        {
          transactionId: "txn_1",
          type: "payment.successful",
          status: "success",
          amount: 200,
          currency: "USD",
          productId: "product_1",
          priceId: "price_1",
          subscriptionId: undefined,
          provider: "powertranz",
          createdAt: new Date("2026-08-04T10:00:00.000Z"),
          metadata: {
            provider: "powertranz",
          },
        },
      ],
      hasMore: true,
      nextCursor: "next-cursor-token",
    });

    const controller = new GetUserTransactionsController({
      execute,
    } as any);

    const response = await controller.handle({
      method: "GET",
      path: "/transactions",
      pathParams: {},
      query: {
        provider: "PowerTranz",
        limit: "25",
        cursor: "cursor-token",
      },
      body: null,
      user: {
        id: "user_1",
        role: "USER",
      },
    });

    expect(execute).toHaveBeenCalledWith({
      userId: "user_1",
      limit: 25,
      provider: "powertranz",
      cursor: "cursor-token",
    });
    expect(response).toEqual(
      expect.objectContaining({
        hasMore: true,
        nextCursor: "next-cursor-token",
        transactions: [
          expect.objectContaining({
            provider: "powertranz",
            createdAt: "2026-08-04T10:00:00.000Z",
          }),
        ],
      }),
    );
  });

  it("rejects a non-positive limit", async () => {
    const controller = new GetUserTransactionsController({
      execute: jest.fn(),
    } as any);

    await expect(
      controller.handle({
        method: "GET",
        path: "/transactions",
        pathParams: {},
        query: {
          limit: "0",
        },
        body: null,
        user: {
          id: "user_1",
          role: "USER",
        },
      }),
    ).rejects.toMatchObject({
      name: "ValidationError",
      message: "limit must be a positive integer",
    });
  });

  it("rejects an unsupported provider", async () => {
    const controller = new GetUserTransactionsController({
      execute: jest.fn(),
    } as any);

    await expect(
      controller.handle({
        method: "GET",
        path: "/transactions",
        pathParams: {},
        query: {
          provider: "paypal",
        },
        body: null,
        user: {
          id: "user_1",
          role: "USER",
        },
      }),
    ).rejects.toMatchObject({
      name: "ValidationError",
      message: "provider must be one of: stripe, powertranz",
    });
  });
});
