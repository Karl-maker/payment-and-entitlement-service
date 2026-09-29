import { AuthenticationError } from "../../libs/domain/src/utils/auth/errors/authentication.error";
import { ForbiddenError } from "../../libs/domain/src/utils/auth/errors/forbidden.error";
import { CreatePriceController } from "../../services/pricing-service/src/app/controllers/create.price.controller";
import { UpdatePriceController } from "../../services/pricing-service/src/app/controllers/update.price.controller";
import { DeletePriceController } from "../../services/pricing-service/src/app/controllers/delete.price.controller";
import { jest } from "@jest/globals";

function makeUseCase() {
  return {
    execute: jest.fn(async () => ({ ok: true })) as any,
  };
}

function makeReq(role?: string, body: any = {}) {
  return {
    method: "POST",
    path: "/prices",
    pathParams: { id: "price-1" },
    query: {},
    body,
    user: role === undefined ? undefined : { id: "user-1", role },
  } as any;
}

describe("Price RBAC", () => {
  describe("CreatePriceController", () => {
    it.each(["admin", "administrator"])(
      "allows users with '%s' role to create prices",
      async (role) => {
        const useCase = makeUseCase();
        const controller = new CreatePriceController(useCase as any);
        const result = await controller.handle(
          makeReq(role, {
            productId: "prod-1",
            billingType: "one_time",
            amount: 100,
            currency: "USD",
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(useCase.execute).toHaveBeenCalled();
      },
    );

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const useCase = makeUseCase();
        const controller = new CreatePriceController(useCase as any);

        await expect(
          controller.handle(
            makeReq(role, {
              productId: "prod-1",
              billingType: "one_time",
              amount: 100,
              currency: "USD",
            }),
          ),
        ).rejects.toThrow(ForbiddenError);
      },
    );

    it("rejects missing user", async () => {
      const useCase = makeUseCase();
      const controller = new CreatePriceController(useCase as any);

      await expect(
        controller.handle({
          ...makeReq(undefined),
        }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("UpdatePriceController", () => {
    it.each(["admin", "administrator"])("allows role %s", async (role) => {
      const useCase = makeUseCase();
      const controller = new UpdatePriceController(useCase as any);

      const result = await controller.handle({
        ...makeReq(role),
        method: "PUT",
        body: { currency: "EUR" },
      });

      expect(result).toEqual({ ok: true });
      expect(useCase.execute).toHaveBeenCalledWith("price-1", {
        currency: "EUR",
      });
    });

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const useCase = makeUseCase();
        const controller = new UpdatePriceController(useCase as any);

        await expect(
          controller.handle({
            ...makeReq(role),
            method: "PUT",
            body: { currency: "EUR" },
          }),
        ).rejects.toThrow(ForbiddenError);
      },
    );
  });

  describe("DeletePriceController", () => {
    it.each(["admin", "administrator"])("allows role %s", async (role) => {
      const useCase = makeUseCase();
      const controller = new DeletePriceController(useCase as any);

      const result = await controller.handle({
        ...makeReq(role),
        method: "DELETE",
      });

      expect(result).toEqual({ ok: true });
      expect(useCase.execute).toHaveBeenCalledWith("price-1");
    });

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const useCase = makeUseCase();
        const controller = new DeletePriceController(useCase as any);

        await expect(
          controller.handle({
            ...makeReq(role),
            method: "DELETE",
          }),
        ).rejects.toThrow(ForbiddenError);
      },
    );
  });
});
