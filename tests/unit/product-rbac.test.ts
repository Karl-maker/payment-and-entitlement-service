import { AuthenticationError } from "../../libs/domain/src/utils/auth/errors/authentication.error";
import { ForbiddenError } from "../../libs/domain/src/utils/auth/errors/forbidden.error";
import { CreateProductController } from "../../services/product-service/src/app/controllers/create.product.controller";
import { UpdateProductController } from "../../services/product-service/src/app/controllers/update.product.controller";
import { DeleteProductController } from "../../services/product-service/src/app/controllers/delete.product.controller";
import { jest } from "@jest/globals";

function makeUseCase() {
  return {
    execute: jest.fn(async () => ({ ok: true })) as any,
  };
}

function makeReq(role?: string) {
  return {
    method: "POST",
    path: "/products",
    pathParams: { id: "product-1" },
    query: {},
    body: {
      name: "Test Product",
      type: "subscription",
      entitlements: ["subject_access"],
      isActive: true,
    },
    user: role === undefined ? undefined : { id: "user-1", role },
  } as any;
}

describe("Product RBAC", () => {
  describe("CreateProductController", () => {
    it.each(["admin", "administrator"])("allows role %s", async (role) => {
      const controller = new CreateProductController(makeUseCase() as any);
      const result = await controller.handle({
        ...makeReq(role),
        method: "POST",
      });

      expect(result).toEqual({ ok: true });
    });

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const controller = new CreateProductController(makeUseCase() as any);

        await expect(
          controller.handle({
            ...makeReq(role),
            method: "POST",
          }),
        ).rejects.toThrow(ForbiddenError);
      },
    );

    it("rejects missing user", async () => {
      const controller = new CreateProductController(makeUseCase() as any);

      await expect(
        controller.handle({
          ...makeReq(undefined),
          method: "POST",
          user: undefined,
        }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("UpdateProductController", () => {
    it.each(["admin", "administrator"])("allows role %s", async (role) => {
      const controller = new UpdateProductController(makeUseCase() as any);

      const result = await controller.handle({
        ...makeReq(role),
        method: "PUT",
        body: { name: "Updated Name" },
      });

      expect(result).toEqual({ ok: true });
    });

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const controller = new UpdateProductController(makeUseCase() as any);

        await expect(
          controller.handle({
            ...makeReq(role),
            method: "PUT",
            body: { name: "Updated Name" },
          }),
        ).rejects.toThrow(ForbiddenError);
      },
    );
  });

  describe("DeleteProductController", () => {
    it.each(["admin", "administrator"])("allows role %s", async (role) => {
      const controller = new DeleteProductController(makeUseCase() as any);

      const result = await controller.handle({
        ...makeReq(role),
        method: "DELETE",
        body: null,
      });

      expect(result).toEqual({ ok: true });
    });

    it.each(["learner", "random-role", "ADMINISTRATORX", ""])(
      "rejects role %s",
      async (role) => {
        const controller = new DeleteProductController(makeUseCase() as any);

        await expect(
          controller.handle({
            ...makeReq(role),
            method: "DELETE",
            body: null,
          }),
        ).rejects.toThrow(ForbiddenError);
      },
    );
  });
});
