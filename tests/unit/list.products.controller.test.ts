import { ListProductsController } from "../../services/product-service/src/app/controllers/list.products.controller";
import { jest } from "@jest/globals";

function makeUseCase(
  result: any = {
    items: [],
    total: 0,
    pageNumber: 1,
    pageSize: 20,
  },
) {
  return {
    execute: jest.fn(async () => result),
  } as any;
}

describe("ListProductsController", () => {
  it("flags active=true to isActive=true", async () => {
    const useCase = makeUseCase({
      items: [{ id: "1" }],
      total: 1,
      pageNumber: 1,
      pageSize: 20,
    });

    const controller = new ListProductsController(useCase as any);

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {
        active: "true",
        page_number: "2",
        page_size: "5",
      },
      headers: {},
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenCalledWith({
      pageNumber: 2,
      pageSize: 5,
      type: undefined,
      isActive: true,
      entitlementKey: undefined,
      userId: undefined,
      country: undefined,
      ipAddress: undefined,
    });
  });

  it("flags active=false to isActive=false", async () => {
    const useCase = makeUseCase({
      items: [{ id: "1" }],
      total: 1,
      pageNumber: 1,
      pageSize: 20,
    });

    const controller = new ListProductsController(useCase as any);

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {
        active: "false",
      },
      headers: {},
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 20,
      type: undefined,
      isActive: false,
      entitlementKey: undefined,
      userId: undefined,
      country: undefined,
      ipAddress: undefined,
    });
  });

  it("supports entitlement_key", async () => {
    const useCase = makeUseCase({
      items: [{ id: "1" }],
      total: 1,
      pageNumber: 1,
      pageSize: 20,
    });

    const controller = new ListProductsController(useCase as any);

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {
        entitlement_key: "subject_access",
      },
      headers: {},
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 20,
      type: undefined,
      isActive: undefined,
      entitlementKey: "subject_access",
      userId: undefined,
      country: undefined,
      ipAddress: undefined,
    });
  });

  it("supports entitlementKey and ignores empty string", async () => {
    const useCase = makeUseCase({
      items: [{ id: "1" }],
      total: 1,
      pageNumber: 1,
      pageSize: 20,
    });

    const controller = new ListProductsController(useCase as any);

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {
        entitlementKey: "token",
      },
      headers: {},
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 20,
      type: undefined,
      isActive: undefined,
      entitlementKey: "token",
      userId: undefined,
      country: undefined,
      ipAddress: undefined,
    });

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {
        entitlement_key: "",
      },
      headers: {},
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenLastCalledWith({
      pageNumber: 1,
      pageSize: 20,
      type: undefined,
      isActive: undefined,
      entitlementKey: undefined,
      userId: undefined,
      country: undefined,
      ipAddress: undefined,
    });
  });

  it("forwards userId, country, and ipAddress from request context", async () => {
    const useCase = makeUseCase({
      items: [{ id: "1" }],
      total: 1,
      pageNumber: 1,
      pageSize: 20,
    });

    const controller = new ListProductsController(useCase as any);

    await controller.handle({
      method: "GET",
      path: "/products",
      pathParams: {},
      query: {},
      headers: {
        "cloudfront-viewer-country": "US",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
      sourceIp: "203.0.113.10",
      user: {
        id: "user-123",
        role: "learner",
      },
      body: null,
    } as any);

    expect(useCase.execute).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 20,
      type: undefined,
      isActive: undefined,
      entitlementKey: undefined,
      userId: "user-123",
      country: "US",
      ipAddress: "203.0.113.10",
    });
  });
});
