import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { createApiGatewayEvent } from "../helpers/fixtures";
import {
  createJwtWithRole,
  createExpiredJwt,
} from "../helpers/jwt-test-helper";
import {
  seedProductForEditDelete,
  seedProductsForByEntitlementTests,
  seedProductsForListAndPaginationTests,
  seedProduct,
  SEED_PRODUCT_ID,
} from "../helpers/product-service-seed";
import {
  findUserIdForBucketBelow,
  findUserIdForBucketAtOrAbove,
} from "../helpers/product-targeting-test-helper";
import {
  TARGET_ENTITLEMENT_KEY,
  ROLLOUT_PERCENTAGE,
  TARGET_PRODUCT_IDS,
  seedByEntitlementCountryTargetedProducts,
  seedByEntitlementCidrTargetedProducts,
  seedByEntitlementPercentageTargetedProduct,
  seedCidrTargetedProducts,
  seedCountryTargetedProducts,
  seedPercentageTargetedProduct,
} from "../helpers/product-targeting-seed-helper";

let handler: (typeof import("../../services/product-service/src/handler/index"))["handler"];

function makeAuthHeaders(userId = "test-user-e2e", role = "learner") {
  return {
    ...createApiGatewayEvent().headers,
    Authorization: `Bearer ${createJwtWithRole(role, userId)}`,
  };
}

type ApiGatewayEventInput = Parameters<typeof createApiGatewayEvent>[0];

function makeAuthedEvent(
  input: ApiGatewayEventInput,
  userId = "test-user-e2e",
  role = "learner",
) {
  return createApiGatewayEvent({
    ...input,
    headers: {
      ...makeAuthHeaders(userId, role),
      ...(input?.headers ?? {}),
    },
  });
}

function productIds(body: any): string[] {
  return (body?.data ?? []).map((p: { productId: string }) => p.productId);
}

const matchingRolloutUserId = findUserIdForBucketBelow(
  ROLLOUT_PERCENTAGE,
  TARGET_ENTITLEMENT_KEY,
);
const nonMatchingRolloutUserId = findUserIdForBucketAtOrAbove(
  ROLLOUT_PERCENTAGE,
  TARGET_ENTITLEMENT_KEY,
);

describe("Product Service E2E", () => {
  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-jwt-secret-for-e2e";

    const mod =
      await import("../../services/product-service/src/handler/index");
    handler = mod.handler;
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
  });

  describe("GET /products", () => {
    beforeEach(async () => {
      const token = createJwtWithRole("admin");
      await handler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/products",
          resource: "/products",
          body: JSON.stringify({
            name: "Basic Plan",
            type: "subscription",
            entitlements: ["subject_access"],
            isActive: true,
          }),
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );
    });

    it("returns 401 Unauthorized when no JWT is provided", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "subscription" },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("should list products when JWT is provided", async () => {
      const token = createJwtWithRole("learner");
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "subscription" },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /products - query params and pagination", () => {
    beforeEach(async () => {
      await seedProductsForListAndPaginationTests();
    });

    it("honors page_size and page_number", async () => {
      const pageSize = 3;
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          page_size: String(pageSize),
          page_number: "1",
        },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeLessThanOrEqual(pageSize);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page_size).toBe(pageSize);
      expect(body.pagination.page_number).toBe(1);
      expect(typeof body.pagination.total_pages).toBe("number");
    });

    it("returns second page when page_number=2", async () => {
      const pageSize = 3;
      const eventPage1 = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          page_size: String(pageSize),
          page_number: "1",
        },
        headers: makeAuthHeaders(),
      });
      const eventPage2 = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          page_size: String(pageSize),
          page_number: "2",
        },
        headers: makeAuthHeaders(),
      });

      const result1 = await handler(eventPage1);
      const result2 = await handler(eventPage2);

      expect(result1.statusCode).toBe(200);
      expect(result2.statusCode).toBe(200);
      const data1 = JSON.parse(result1.body).data;
      const data2 = JSON.parse(result2.body).data;
      expect(data1.length).toBeLessThanOrEqual(pageSize);
      expect(data2.length).toBeLessThanOrEqual(pageSize);
      const ids1 = new Set<string>(
        data1.map((p: { productId: string }) => p.productId),
      );
      const ids2 = new Set<string>(
        data2.map((p: { productId: string }) => p.productId),
      );
      ids1.forEach((id) => expect(ids2.has(id)).toBe(false));
    });

    it("filters by type=subscription", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "subscription" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { type: string }) => {
        expect(p.type).toBe("subscription");
      });
      expect(body.data.length).toBeGreaterThanOrEqual(6);
    });

    it("filters by type=one_off", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "one_off" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { type: string }) => {
        expect(p.type).toBe("one_off");
      });
      expect(body.data.length).toBe(3);
    });

    it("filters by type=addon", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "addon" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { type: string }) => {
        expect(p.type).toBe("addon");
      });
      expect(body.data.length).toBe(2);
    });

    it("filters by active=true", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { active: "true" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { isActive: boolean }) => {
        expect(p.isActive).toBe(true);
      });
    });

    it("filters by active=false", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { active: "false" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { isActive: boolean }) => {
        expect(p.isActive).toBe(false);
      });
      expect(body.data.length).toBe(4);
    });

    it("filters by entitlementKey (entitlement_key)", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { entitlement_key: "subject_access" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { entitlements: string[] }) => {
        expect(p.entitlements).toContain("subject_access");
      });
      expect(body.data.length).toBeGreaterThanOrEqual(5);
    });

    it("filters by entitlementKey (camelCase entitlementKey)", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { entitlementKey: "token" },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(Array.isArray(body.data)).toBe(true);
      body.data.forEach((p: { entitlements: string[] }) => {
        expect(p.entitlements).toContain("token");
      });
      expect(body.data.length).toBeGreaterThanOrEqual(5);
    });

    it("combines type, active, and pagination", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
          active: "true",
          page_size: "2",
          page_number: "1",
        },
        headers: makeAuthHeaders(),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.length).toBeLessThanOrEqual(2);
      body.data.forEach((p: { type: string; isActive: boolean }) => {
        expect(p.type).toBe("subscription");
        expect(p.isActive).toBe(true);
      });
      expect(body.pagination.page_size).toBe(2);
      expect(body.pagination.page_number).toBe(1);
    });

    it("filters products by CloudFront country header", async () => {
      await seedCountryTargetedProducts();

      const usEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "subscription" },
        headers: { "cloudfront-viewer-country": "US" },
      });

      const usResult = await handler(usEvent);

      expect(usResult.statusCode).toBe(200);
      const usBody = JSON.parse(usResult.body);
      expect(usBody.data.length).toBeGreaterThan(0);
      expect(productIds(usBody)).toContain(TARGET_PRODUCT_IDS.countryUs);
      expect(productIds(usBody)).not.toContain(TARGET_PRODUCT_IDS.countryCa);

      const caEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: { type: "subscription" },
        headers: { "cloudfront-viewer-country": "CA" },
      });

      const caResult = await handler(caEvent);

      expect(caResult.statusCode).toBe(200);
      const caBody = JSON.parse(caResult.body);
      expect(caBody.data.length).toBeGreaterThan(0);
      expect(productIds(caBody)).toContain(TARGET_PRODUCT_IDS.countryCa);
      expect(productIds(caBody)).not.toContain(TARGET_PRODUCT_IDS.countryUs);
    });

    it("filters products by user percentage rollout", async () => {
      await seedPercentageTargetedProduct();

      const matchingEvent = makeAuthedEvent(
        {
          httpMethod: "GET",
          path: "/products",
          resource: "/products",
          queryStringParameters: {
            type: "subscription",
            entitlement_key: TARGET_ENTITLEMENT_KEY,
          },
        },
        matchingRolloutUserId,
      );

      const matchingResult = await handler(matchingEvent);

      expect(matchingResult.statusCode).toBe(200);
      const matchingBody = JSON.parse(matchingResult.body);
      expect(productIds(matchingBody)).toContain(TARGET_PRODUCT_IDS.percent20);

      const nonMatchingEvent = makeAuthedEvent(
        {
          httpMethod: "GET",
          path: "/products",
          resource: "/products",
          queryStringParameters: {
            type: "subscription",
            entitlement_key: TARGET_ENTITLEMENT_KEY,
          },
        },
        nonMatchingRolloutUserId,
      );

      const nonMatchingResult = await handler(nonMatchingEvent);

      expect(nonMatchingResult.statusCode).toBe(200);
      const nonMatchingBody = JSON.parse(nonMatchingResult.body);
      expect(productIds(nonMatchingBody)).not.toContain(
        TARGET_PRODUCT_IDS.percent20,
      );
    });
    it("filters products by IP CIDR block", async () => {
      await seedCidrTargetedProducts();

      const allowedEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
        },
        headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      });

      const allowedResult = await handler(allowedEvent);

      expect(allowedResult.statusCode).toBe(200);
      const allowedBody = JSON.parse(allowedResult.body);
      expect(productIds(allowedBody)).toContain(TARGET_PRODUCT_IDS.cidrAllowed);
      expect(productIds(allowedBody)).not.toContain(
        TARGET_PRODUCT_IDS.cidrDenied,
      );

      const deniedEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
        },
        headers: { "x-forwarded-for": "192.0.2.10, 10.0.0.1" },
      });

      const deniedResult = await handler(deniedEvent);

      expect(deniedResult.statusCode).toBe(200);
      const deniedBody = JSON.parse(deniedResult.body);
      expect(productIds(deniedBody)).not.toContain(
        TARGET_PRODUCT_IDS.cidrAllowed,
      );
    });
    it("requires all targeting rules to pass", async () => {
      await seedProduct({
        productId: TARGET_PRODUCT_IDS.andTargeted,
        name: "Country And CIDR Product",
        entitlements: ["subject_access"],
        targeting: {
          countries: ["US"],
          cidrBlocks: ["203.0.113.0/24"],
        },
      });

      const matchingEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
        },
        headers: {
          "cloudfront-viewer-country": "US",
          "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        },
      });

      const matchingResult = await handler(matchingEvent);

      expect(matchingResult.statusCode).toBe(200);
      const matchingBody = JSON.parse(matchingResult.body);
      expect(productIds(matchingBody)).toContain(
        TARGET_PRODUCT_IDS.andTargeted,
      );

      const missingCountryEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
        },
        headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      });

      const missingCountryResult = await handler(missingCountryEvent);

      expect(missingCountryResult.statusCode).toBe(200);
      const missingCountryBody = JSON.parse(missingCountryResult.body);
      expect(productIds(missingCountryBody)).not.toContain(
        TARGET_PRODUCT_IDS.andTargeted,
      );

      const missingIpEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        queryStringParameters: {
          type: "subscription",
        },
        headers: {
          "cloudfront-viewer-country": "US",
          "x-forwarded-for": "192.0.2.10, 10.0.0.1",
        },
      });

      const missingIpResult = await handler(missingIpEvent);

      expect(missingIpResult.statusCode).toBe(200);
      const missingIpBody = JSON.parse(missingIpResult.body);
      expect(productIds(missingIpBody)).not.toContain(
        TARGET_PRODUCT_IDS.andTargeted,
      );
    });
  });

  describe("GET /products/by-entitlement/{entitlementKey}", () => {
    it("filters by entitlement key and CloudFront country header", async () => {
      await seedByEntitlementCountryTargetedProducts();

      const usEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
        headers: { "cloudfront-viewer-country": "US" },
        body: null,
      });

      const usResult = await handler(usEvent);

      expect(usResult.statusCode).toBe(200);
      const usBody = JSON.parse(usResult.body);
      expect(productIds(usBody)).toContain(TARGET_PRODUCT_IDS.byEntCountryUs);
      expect(productIds(usBody)).not.toContain(
        TARGET_PRODUCT_IDS.byEntCountryCa,
      );

      const caEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
        headers: { "cloudfront-viewer-country": "CA" },
        body: null,
      });

      const caResult = await handler(caEvent);

      expect(caResult.statusCode).toBe(200);
      const caBody = JSON.parse(caResult.body);
      expect(productIds(caBody)).toContain(TARGET_PRODUCT_IDS.byEntCountryCa);
      expect(productIds(caBody)).not.toContain(
        TARGET_PRODUCT_IDS.byEntCountryUs,
      );
    });

    it("filters by entitlement key and IP CIDR block", async () => {
      await seedByEntitlementCidrTargetedProducts();

      const allowedEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
        headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
        body: null,
      });

      const allowedResult = await handler(allowedEvent);

      expect(allowedResult.statusCode).toBe(200);
      const allowedBody = JSON.parse(allowedResult.body);
      expect(productIds(allowedBody)).toContain(
        TARGET_PRODUCT_IDS.byEntCidrAllowed,
      );
      expect(productIds(allowedBody)).not.toContain(
        TARGET_PRODUCT_IDS.byEntCidrDenied,
      );

      const deniedEvent = makeAuthedEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
        headers: { "x-forwarded-for": "192.0.2.10, 10.0.0.1" },
        body: null,
      });

      const deniedResult = await handler(deniedEvent);

      expect(deniedResult.statusCode).toBe(200);
      const deniedBody = JSON.parse(deniedResult.body);
      expect(productIds(deniedBody)).not.toContain(
        TARGET_PRODUCT_IDS.byEntCidrAllowed,
      );
    });

    it("filters by entitlement key and user percentage rollout", async () => {
      await seedByEntitlementPercentageTargetedProduct();

      const matchingEvent = makeAuthedEvent(
        {
          httpMethod: "GET",
          path: "/products/by-entitlement/subject_access",
          resource: "/products/by-entitlement/{entitlementKey}",
          pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
          body: null,
        },
        matchingRolloutUserId,
      );

      const matchingResult = await handler(matchingEvent);

      expect(matchingResult.statusCode).toBe(200);
      const matchingBody = JSON.parse(matchingResult.body);
      expect(productIds(matchingBody)).toContain(
        TARGET_PRODUCT_IDS.byEntPercent20,
      );

      const nonMatchingEvent = makeAuthedEvent(
        {
          httpMethod: "GET",
          path: "/products/by-entitlement/subject_access",
          resource: "/products/by-entitlement/{entitlementKey}",
          pathParameters: { entitlementKey: TARGET_ENTITLEMENT_KEY },
          body: null,
        },
        nonMatchingRolloutUserId,
      );

      const nonMatchingResult = await handler(nonMatchingEvent);

      expect(nonMatchingResult.statusCode).toBe(200);
      const nonMatchingBody = JSON.parse(nonMatchingResult.body);
      expect(productIds(nonMatchingBody)).not.toContain(
        TARGET_PRODUCT_IDS.byEntPercent20,
      );
    });
  });

  describe("GET /products/{id}", () => {
    it("returns 401 Unauthorized when no JWT is provided", async () => {
      const token = createJwtWithRole("admin");
      const createRes = await handler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/products",
          resource: "/products",
          body: JSON.stringify({
            name: "Lookup Plan",
            type: "subscription",
            entitlements: ["subject_access"],
            isActive: true,
          }),
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );
      const productId = JSON.parse(createRes.body).productId;

      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${productId}`,
        resource: "/products/{id}",
        pathParameters: { id: productId },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("should get a product by ID when JWT is provided", async () => {
      const token = createJwtWithRole("admin");
      const createRes = await handler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/products",
          resource: "/products",
          body: JSON.stringify({
            name: "Lookup Plan",
            type: "subscription",
            entitlements: ["subject_access"],
            isActive: true,
          }),
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );

      const productId = JSON.parse(createRes.body).productId;
      const getToken = createJwtWithRole("learner");
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${productId}`,
        resource: "/products/{id}",
        pathParameters: { id: productId },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${getToken}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.productId).toBe(productId);
      expect(body.name).toBe("Lookup Plan");
    });

    it("should return 404 for non-existent product", async () => {
      const token = createJwtWithRole("learner");
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/nonexistent-id",
        resource: "/products/{id}",
        pathParameters: { id: "nonexistent-id" },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });
  });

  describe("OPTIONS (CORS preflight)", () => {
    it("should return 204 with CORS headers", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "OPTIONS",
        path: "/products",
        resource: "/products",
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(204);
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown route", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/nonexistent",
        resource: "/nonexistent",
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });
  });

  describe("expired token returns 401 Unauthorized", () => {
    const expiredToken = () => createExpiredJwt("admin");

    it("GET /products returns 401 with expired JWT", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products",
        resource: "/products",
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("GET /products/{id} returns 401 with expired JWT", async () => {
      await seedProductForEditDelete();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("POST /products returns 401 with expired JWT", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/products",
        resource: "/products",
        body: JSON.stringify({
          name: "Plan",
          type: "subscription",
          entitlements: ["subject_access"],
          isActive: true,
        }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("PUT /products/{id} returns 401 with expired JWT", async () => {
      await seedProductForEditDelete();
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: JSON.stringify({ name: "Updated" }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("DELETE /products/{id} returns 401 with expired JWT", async () => {
      await seedProductForEditDelete();
      const event = createApiGatewayEvent({
        httpMethod: "DELETE",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("GET /products/by-entitlement/{entitlementKey} returns 401 with expired JWT", async () => {
      await seedProductsForByEntitlementTests();
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "subject_access" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${expiredToken()}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });

  describe("POST /products - role-based access", () => {
    const createPayload = {
      name: "Admin-Only Plan",
      type: "subscription",
      entitlements: ["subject_access"],
      isActive: true,
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
      "returns 403 Forbidden when JWT role '%s' is not admin/administrator",
      async (role) => {
        const token = createJwtWithRole(role);
        const event = createApiGatewayEvent({
          httpMethod: "POST",
          path: "/products",
          resource: "/products",
          body: JSON.stringify(createPayload),
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
      },
    );

    it("returns 201 and correct product when JWT role is admin", async () => {
      const token = createJwtWithRole("admin");
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/products",
        resource: "/products",
        body: JSON.stringify(createPayload),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("productId");
      expect(typeof body.productId).toBe("string");
      expect(body.productId.length).toBeGreaterThan(0);

      const getEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${body.productId}`,
        resource: "/products/{id}",
        pathParameters: { id: body.productId },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const getResult = await handler(getEvent);
      expect(getResult.statusCode).toBe(200);
      const product = JSON.parse(getResult.body);
      expect(product.productId).toBe(body.productId);
      expect(product.name).toBe(createPayload.name);
      expect(product.type).toBe(createPayload.type);
      expect(product.entitlements).toEqual(createPayload.entitlements);
      expect(product.isActive).toBe(createPayload.isActive);
    });

    it("returns 201 and correct product when JWT role is administrator", async () => {
      const token = createJwtWithRole("administrator");
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/products",
        resource: "/products",
        body: JSON.stringify(createPayload),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("productId");
      expect(typeof body.productId).toBe("string");
      expect(body.productId.length).toBeGreaterThan(0);

      const getEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${body.productId}`,
        resource: "/products/{id}",
        pathParameters: { id: body.productId },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const getResult = await handler(getEvent);
      expect(getResult.statusCode).toBe(200);
      const product = JSON.parse(getResult.body);
      expect(product.productId).toBe(body.productId);
      expect(product.name).toBe(createPayload.name);
      expect(product.type).toBe(createPayload.type);
      expect(product.entitlements).toEqual(createPayload.entitlements);
      expect(product.isActive).toBe(createPayload.isActive);
    });

    it("returns 201 and correct product with usage when JWT role is admin and usage matches entitlements", async () => {
      const token = createJwtWithRole("admin");
      const payloadWithUsage = {
        name: "Plan With Usage",
        type: "subscription",
        entitlements: ["subject_access", "token"],
        usageLimits: [
          { metric: "subject_access", limit: 100, period: "month" },
          { metric: "token", limit: 1000, period: "day" },
        ],
        isActive: true,
      };
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/products",
        resource: "/products",
        body: JSON.stringify(payloadWithUsage),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("productId");
      expect(typeof body.productId).toBe("string");
      expect(body.productId.length).toBeGreaterThan(0);

      const getEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${body.productId}`,
        resource: "/products/{id}",
        pathParameters: { id: body.productId },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const getResult = await handler(getEvent);
      expect(getResult.statusCode).toBe(200);
      const product = JSON.parse(getResult.body);
      expect(product.productId).toBe(body.productId);
      expect(product.name).toBe(payloadWithUsage.name);
      expect(product.entitlements).toEqual(payloadWithUsage.entitlements);
      expect(product.usageLimits).toEqual(
        expect.arrayContaining(payloadWithUsage.usageLimits),
      );
    });

    it("returns 400 when usage metric does not match any entitlement", async () => {
      const token = createJwtWithRole("admin");
      const payloadWithInvalidUsage = {
        name: "Plan With Invalid Usage",
        type: "subscription",
        entitlements: ["subject_access"],
        usageLimits: [
          { metric: "subject_access", limit: 100, period: "month" },
          { metric: "unknown_metric", limit: 50, period: "day" },
        ],
        isActive: true,
      };
      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/products",
        resource: "/products",
        body: JSON.stringify(payloadWithInvalidUsage),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe("PUT /products/:id - role-based access", () => {
    beforeEach(async () => {
      await seedProductForEditDelete();
    });

    it("returns 403 Forbidden when JWT role is not admin or administrator", async () => {
      const token = createJwtWithRole("learner");
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: JSON.stringify({ name: "Updated Name" }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    });

    it("returns 200 and updated product when JWT role is admin", async () => {
      const token = createJwtWithRole("admin");
      const updatedName = "Updated by Admin";
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: JSON.stringify({ name: updatedName }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("productId", SEED_PRODUCT_ID);
      expect(body).toHaveProperty("name", updatedName);
    });

    it("returns 200 and updated product when updating usage and entitlements with admin role", async () => {
      const token = createJwtWithRole("admin");
      const updatedEntitlements = ["subject_access", "token"];
      const updatedUsageLimits = [
        { metric: "subject_access", limit: 200, period: "month" },
        { metric: "token", limit: 500, period: "day" },
      ];
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: JSON.stringify({
          entitlements: updatedEntitlements,
          usageLimits: updatedUsageLimits,
        }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("productId", SEED_PRODUCT_ID);

      const getEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const getResult = await handler(getEvent);
      expect(getResult.statusCode).toBe(200);
      const product = JSON.parse(getResult.body);
      expect(product.entitlements).toEqual(
        expect.arrayContaining(updatedEntitlements),
      );
      expect(product.usageLimits).toEqual(
        expect.arrayContaining(updatedUsageLimits),
      );
    });

    it("returns 400 when updating with usage that does not exist in entitlements", async () => {
      const token = createJwtWithRole("admin");
      const event = createApiGatewayEvent({
        httpMethod: "PUT",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: JSON.stringify({
          usageLimits: [
            { metric: "subject_access", limit: 100, period: "month" },
            { metric: "nonexistent_entitlement", limit: 10, period: "day" },
          ],
        }),
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe("DELETE /products/:id - role-based access", () => {
    beforeEach(async () => {
      await seedProductForEditDelete();
    });

    it("returns 403 Forbidden when JWT role is not admin or administrator", async () => {
      const token = createJwtWithRole("learner");
      const event = createApiGatewayEvent({
        httpMethod: "DELETE",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    });

    it("returns 204 when JWT role is admin", async () => {
      const token = createJwtWithRole("admin");
      const event = createApiGatewayEvent({
        httpMethod: "DELETE",
        path: `/products/${SEED_PRODUCT_ID}`,
        resource: "/products/{id}",
        pathParameters: { id: SEED_PRODUCT_ID },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(204);
    });
  });

  describe("GET /products/by-entitlement/{entitlementKey}", () => {
    beforeEach(async () => {
      await seedProductsForByEntitlementTests();
    });

    it("returns 401 Unauthorized when no JWT is provided", async () => {
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "subject_access" },
        body: null,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it("returns products that have the given entitlement key (one key)", async () => {
      const token = createJwtWithRole("admin");
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "subject_access" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      const productIds = body.data.map(
        (p: { productId: string }) => p.productId,
      );
      expect(productIds).toContain("seed-by-ent-one-key");
      expect(productIds).toContain("seed-by-ent-two-keys");
    });

    it("returns products when querying by one of two entitlement keys", async () => {
      const token = createJwtWithRole("admin");
      const event = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/token",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "token" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        body.data.some(
          (p: { productId: string }) => p.productId === "seed-by-ent-two-keys",
        ),
      ).toBe(true);
    });

    it("is not case sensitive for entitlement key", async () => {
      const token = createJwtWithRole("admin");
      const lowerEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/subject_access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "subject_access" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const mixedEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/Subject_Access",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "Subject_Access" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });
      const upperEvent = createApiGatewayEvent({
        httpMethod: "GET",
        path: "/products/by-entitlement/SUBJECT_ACCESS",
        resource: "/products/by-entitlement/{entitlementKey}",
        pathParameters: { entitlementKey: "SUBJECT_ACCESS" },
        body: null,
        headers: {
          ...createApiGatewayEvent().headers,
          Authorization: `Bearer ${token}`,
        },
      });

      const lowerResult = await handler(lowerEvent);
      const mixedResult = await handler(mixedEvent);
      const upperResult = await handler(upperEvent);

      expect(lowerResult.statusCode).toBe(200);
      expect(mixedResult.statusCode).toBe(200);
      expect(upperResult.statusCode).toBe(200);
      const lowerBody = JSON.parse(lowerResult.body);
      const mixedBody = JSON.parse(mixedResult.body);
      const upperBody = JSON.parse(upperResult.body);
      expect(lowerBody.data.length).toBe(mixedBody.data.length);
      expect(lowerBody.data.length).toBe(upperBody.data.length);
    });

    it("treats ai_tutor, ai-tutor, ai.tutor as different keys", async () => {
      const token = createJwtWithRole("admin");

      const resUnderscore = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/products/by-entitlement/ai_tutor",
          resource: "/products/by-entitlement/{entitlementKey}",
          pathParameters: { entitlementKey: "ai_tutor" },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );
      const resHyphen = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/products/by-entitlement/ai-tutor",
          resource: "/products/by-entitlement/{entitlementKey}",
          pathParameters: { entitlementKey: "ai-tutor" },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );
      const resDot = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/products/by-entitlement/ai.tutor",
          resource: "/products/by-entitlement/{entitlementKey}",
          pathParameters: { entitlementKey: "ai.tutor" },
          body: null,
          headers: {
            ...createApiGatewayEvent().headers,
            Authorization: `Bearer ${token}`,
          },
        }),
      );

      expect(resUnderscore.statusCode).toBe(200);
      expect(resHyphen.statusCode).toBe(200);
      expect(resDot.statusCode).toBe(200);
      const dataUnderscore = JSON.parse(resUnderscore.body).data;
      const dataHyphen = JSON.parse(resHyphen.body).data;
      const dataDot = JSON.parse(resDot.body).data;

      expect(dataUnderscore.length).toBe(1);
      expect(dataUnderscore[0].productId).toBe("seed-ai-underscore");
      expect(dataHyphen.length).toBe(1);
      expect(dataHyphen[0].productId).toBe("seed-ai-hyphen");
      expect(dataDot.length).toBe(1);
      expect(dataDot[0].productId).toBe("seed-ai-dot");
    });
  });
});
