import { AuthenticationError } from "@libs/domain";
import { CreatePaymentIntentController } from "../../../services/powertranz-service/src/app/controllers/create.payment.intent.controller";
import { BadRequestError } from "../../../services/powertranz-service/src/app/errors/bad-request.error";

describe("CreatePaymentIntentController", () => {
  function buildController() {
    const useCase = {
      execute: jest.fn().mockResolvedValue({ spiToken: "spi_123" }),
    };

    return {
      controller: new CreatePaymentIntentController(useCase as any),
      useCase,
    };
  }

  it("passes optional card_type through to the use case", async () => {
    const { controller, useCase } = buildController();

    await controller.handle({
      method: "POST",
      path: "/powertranz/payment-intents",
      pathParams: {},
      query: {},
      headers: {},
      body: {
        price_id: "price_1",
        card_type: "credit",
      },
      user: {
        id: "user_1",
        email: "buyer@example.com",
      },
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      userId: "user_1",
      userEmail: "buyer@example.com",
      priceId: "price_1",
      cardType: "credit",
    });
  });

  it("defaults missing card_type to credit behavior by omitting the override", async () => {
    const { controller, useCase } = buildController();

    await controller.handle({
      method: "POST",
      path: "/powertranz/payment-intents",
      pathParams: {},
      query: {},
      headers: {},
      body: {
        price_id: "price_1",
      },
      user: {
        id: "user_1",
        email: "buyer@example.com",
      },
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      userId: "user_1",
      userEmail: "buyer@example.com",
      priceId: "price_1",
      cardType: undefined,
    });
  });

  it("rejects unsupported card_type values", async () => {
    const { controller } = buildController();

    await expect(
      controller.handle({
        method: "POST",
        path: "/powertranz/payment-intents",
        pathParams: {},
        query: {},
        headers: {},
        body: {
          price_id: "price_1",
          card_type: "prepaid",
        },
        user: {
          id: "user_1",
        },
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("requires an authenticated user", async () => {
    const { controller } = buildController();

    await expect(
      controller.handle({
        method: "POST",
        path: "/powertranz/payment-intents",
        pathParams: {},
        query: {},
        headers: {},
        body: {
          price_id: "price_1",
        },
      } as any),
    ).rejects.toThrow(AuthenticationError);
  });
});
