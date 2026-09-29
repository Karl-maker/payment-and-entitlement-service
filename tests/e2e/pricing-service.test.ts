import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { createApiGatewayEvent } from "../helpers/fixtures";
import { createJwtWithRole, createExpiredJwt } from "../helpers/jwt-test-helper";
import {
  seedProductForPricingPostTests,
  seedPricesForListByProductTests,
  PRICING_SEED_PRODUCT_ID,
} from "../helpers/pricing-service-seed";

let handler: typeof import("../../services/pricing-service/src/handler/index")["handler"];

const validOneTimePriceBody = () => ({
  productId: PRICING_SEED_PRODUCT_ID,
  billingType: "one_time",
  amount: 1999,
  currency: "USD",
});

describe("Pricing Service E2E — POST /prices", () => {
  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-jwt-secret-for-e2e";

    const mod = await import(
      "../../services/pricing-service/src/handler/index"
    );
    handler = mod.handler;
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
    await clearTable(TABLE_NAMES.prices);
    await seedProductForPricingPostTests();
  });

  it("returns 201 when admin JWT is valid and productId, currency (USD), and body are valid", async () => {
    const token = createJwtWithRole("admin");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify(validOneTimePriceBody()),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty("priceId");
    expect(typeof body.priceId).toBe("string");
    expect(body.priceId.length).toBeGreaterThan(0);
  });

  it("returns 201 with administrator role JWT", async () => {
    const token = createJwtWithRole("administrator");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify(validOneTimePriceBody()),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toHaveProperty("priceId");
  });

  it("returns 201 when currency is token", async () => {
    const token = createJwtWithRole("admin");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify({
        ...validOneTimePriceBody(),
        currency: "token",
      }),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toHaveProperty("priceId");
  });

  it("returns 201 when currency is a valid ISO code (EUR)", async () => {
    const token = createJwtWithRole("admin");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify({
        ...validOneTimePriceBody(),
        currency: "EUR",
      }),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toHaveProperty("priceId");
  });

  it("returns 401 when no JWT is provided", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify(validOneTimePriceBody()),
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it("returns 401 when JWT is expired", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify(validOneTimePriceBody()),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${createExpiredJwt("admin")}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  const forbiddenRoles = ["learner", "teacher", "educator", "support", "random-role", "ADMINISTRATORX", ""];

  it.each(forbiddenRoles)(
    "returns 403 when JWT role '%s' is not admin/administrator",
    async (role) => {
      const token = createJwtWithRole(role);
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/prices",
        resource: "/prices",
        body: JSON.stringify(validOneTimePriceBody()),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    }
  );

  it("returns 400 when currency is not an allowed ISO code or token", async () => {
    const token = createJwtWithRole("admin");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify({
        ...validOneTimePriceBody(),
        currency: "XXX",
      }),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it("returns 404 when productId does not exist", async () => {
    const token = createJwtWithRole("admin");
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body: JSON.stringify({
        ...validOneTimePriceBody(),
        productId: "nonexistent-product-id-xyz",
      }),
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });


  describe("GET /prices/product/{productId}", () => {
    it("returns all prices connected to productId and excludes others", async () => {
      const seeded = await seedPricesForListByProductTests();

      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/prices/product/${seeded.targetProductId}`,
        resource: "/prices/product/{productId}",
        pathParameters: { productId: seeded.targetProductId },
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(seeded.targetPriceIds.length);

      const ids = body.data.map((p: { priceId: string }) => p.priceId);
      seeded.targetPriceIds.forEach((id) => expect(ids).toContain(id));
      seeded.otherPriceIds.forEach((id) => expect(ids).not.toContain(id));
    });

    const readableRoles = [
      "admin",
      "administrator",
      "learner",
      "teacher",
      "educator",
      "support",
      "random-role",
      "",
    ];

    it.each(readableRoles)(
      "allows role '%s' to fetch prices by productId",
      async (role) => {
        const seeded = await seedPricesForListByProductTests();
        const event = createApiGatewayEvent({
          httpMethod: "GET",
          path: `/prices/product/${seeded.targetProductId}`,
          resource: "/prices/product/{productId}",
          pathParameters: { productId: seeded.targetProductId },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${createJwtWithRole(role)}`,
          },
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBe(seeded.targetPriceIds.length);
      }
    );

    it("allows fetch with no JWT", async () => {
      const seeded = await seedPricesForListByProductTests();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/prices/product/${seeded.targetProductId}`,
        resource: "/prices/product/{productId}",
        pathParameters: { productId: seeded.targetProductId },
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(seeded.targetPriceIds.length);
    });
  });


  describe("GET /prices/{id}", () => {
    const adminHeaders = () => ({
      ...createApiGatewayEvent().headers,
      Authorization: `Bearer ${createJwtWithRole("admin")}`,
    });

    const createPriceAsAdmin = async (): Promise<string> => {
      const createRes = await handler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/prices",
          resource: "/prices",
          body: JSON.stringify(validOneTimePriceBody()),
          headers: adminHeaders(),
        })
      );
      expect(createRes.statusCode).toBe(201);
      return JSON.parse(createRes.body).priceId as string;
    };

    const allowedRoles = [
      "admin",
      "administrator",
      "learner",
      "teacher",
      "educator",
      "support",
      "random-role",
      "",
    ];

    it.each(allowedRoles)(
      "allows role '%s' with valid JWT to fetch /prices/{id}",
      async (role) => {
        const priceId = await createPriceAsAdmin();
        const event = createApiGatewayEvent({
          httpMethod: "GET",
          path: `/prices/${priceId}`,
          resource: "/prices/{id}",
          pathParameters: { id: priceId },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${createJwtWithRole(role)}`,
          },
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.priceId).toBe(priceId);
        expect(body.productId).toBe(PRICING_SEED_PRODUCT_ID);
      }
    );

    it("blocks missing JWT (401)", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("blocks expired JWT (401)", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${createExpiredJwt("admin")}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("blocks malformed JWT (401)", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: "Bearer not-a-valid-jwt",
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });


  describe("PUT /prices/:id and DELETE /prices/:id — role-based access", () => {
    const adminHeaders = () => ({
      ...createApiGatewayEvent().headers,
      Authorization: `Bearer ${createJwtWithRole("admin")}`,
    });

    const createPriceAsAdmin = async (): Promise<string> => {
      const createRes = await handler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/prices",
          resource: "/prices",
          body: JSON.stringify({
            ...validOneTimePriceBody(),
          }),
          headers: adminHeaders(),
        })
      );
      expect(createRes.statusCode).toBe(201);
      return JSON.parse(createRes.body).priceId as string;
    };

    const forbiddenRoles = [
      "learner",
      "teacher",
      "educator",
      "support",
      "random-role",
      "ADMINISTRATORX",
      "",
    ];

    it.each(forbiddenRoles)(
      "PUT /prices/:id returns 403 for non-admin role '%s'",
      async (role) => {
        const priceId = await createPriceAsAdmin();
        const event = createApiGatewayEvent({
          httpMethod: "PUT",
          path: `/prices/${priceId}`,
          resource: "/prices/{id}",
          pathParameters: { id: priceId },
          body: JSON.stringify({ currency: "EUR" }),
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${createJwtWithRole(role)}`,
          },
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
      }
    );

    it.each(forbiddenRoles)(
      "DELETE /prices/:id returns 403 for non-admin role '%s'",
      async (role) => {
        const priceId = await createPriceAsAdmin();
        const event = createApiGatewayEvent({
          httpMethod: "DELETE",
          path: `/prices/${priceId}`,
          resource: "/prices/{id}",
          pathParameters: { id: priceId },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${createJwtWithRole(role)}`,
          },
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
      }
    );

    it("PUT /prices/:id returns 200 for admin role when currency is valid (EUR)", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: JSON.stringify({ currency: "EUR" }),
        headers: adminHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.updated).toBe(true);
      expect(body.priceId).toBe(priceId);
    });

    it("PUT /prices/:id returns 200 for admin role when currency is token", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: JSON.stringify({ currency: "token" }),
        headers: adminHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.updated).toBe(true);
      expect(body.priceId).toBe(priceId);
    });

    it("PUT /prices/:id returns 400 for admin role when currency is invalid", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: JSON.stringify({ currency: "INVALID" }),
        headers: adminHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    it("DELETE /prices/:id returns 204 for admin role", async () => {
      const priceId = await createPriceAsAdmin();
      const event = createApiGatewayEvent({
        httpMethod: "DELETE",
        path: `/prices/${priceId}`,
        resource: "/prices/{id}",
        pathParameters: { id: priceId },
        body: null,
        headers: adminHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(204);
    });
  });

});
