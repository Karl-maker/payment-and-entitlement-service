import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { seedProductForPricingPostTests } from "../helpers/pricing-service-seed";
import { createJwtWithRole } from "../helpers/jwt-test-helper";
import { handler } from "../../services/pricing-service/src/handler";
import { createApiGatewayEvent } from "../helpers/fixtures";

describe("Pricing Service - Use Case and RBAC Integration Tests", () => {
  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-jwt-secret-for-e2e";
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
    await clearTable(TABLE_NAMES.prices);
    await seedProductForPricingPostTests();
  });

  const body = JSON.stringify({
    productId: "pricing-seed-product-1",
    billingType: "one_time",
    amount: 1999,
    currency: "USD",
  });

  const forbiddenRoles = [
    "learner",
    "teacher",
    "random-role",
    "ADMINISTRATORX",
    "",
  ];

  it("returns 401 when no JWT token is provided", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body,
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it.each(forbiddenRoles)(
    "returns 403 for invalid role %s on POST /prices",
    async (role) => {
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/prices",
        resource: "/prices",
        body,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${createJwtWithRole(role)}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    },
  );

  it("returns 201 for admin on POST /prices", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "POST",
      path: "/prices",
      resource: "/prices",
      body,
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${createJwtWithRole("admin")}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(201);
  });

  it("returns 403 for invalid role on DELETE /prices/{id}", async () => {
    const createRes = await handler(
      createApiGatewayEvent({
        httpMethod: "POST",
        path: "/prices",
        resource: "/prices",
        body,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${createJwtWithRole("admin")}`,
        },
      }),
    );

    const priceId = JSON.parse(createRes.body).priceId;

    const event = createApiGatewayEvent({
      httpMethod: "DELETE",
      path: `/prices/${priceId}`,
      resource: "/prices/{id}",
      pathParameters: { id: priceId },
      body: null,
      headers: {
        ...createApiGatewayEvent().headers,
        Authorization: `Bearer ${createJwtWithRole("random-role")}`,
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
  });
});
