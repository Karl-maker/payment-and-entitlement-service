import {
  BillingType,
  DynamoEntitlementRepository,
  DynamoPriceRepository,
  DynamoProductRepository,
  Entitlement,
  EntitlementKey,
  EntitlementStatus,
  EntitlementUsage,
  Price,
  ProductType,
} from "@libs/domain";
import { APIGatewayProxyEvent } from "aws-lambda";
import { createApiGatewayEvent } from "../helpers/fixtures";
import { createJwtWithRole } from "../helpers/jwt-test-helper";
import { createProduct } from "../helpers/product";
import {
  clearTable,
  createAllTables,
  deleteAllTables,
  docClient,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";

let tokenHandler: (event: APIGatewayProxyEvent) => Promise<any>;
let accessHandler: (event: APIGatewayProxyEvent) => Promise<any>;

function authHeaders(token: string, extraHeaders: Record<string, string> = {}) {
  return {
    ...createApiGatewayEvent().headers,
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
}

async function seedPrice(params: {
  priceId: string;
  productId: string;
  amount: number;
  currency: string;
}) {
  const priceRepo = new DynamoPriceRepository();
  const price = Price.create({
    priceId: params.priceId,
    productId: params.productId,
    billingType: BillingType.ONE_TIME,
    amount: params.amount,
    currency: params.currency,
  });

  await priceRepo.create(price);
  return price;
}

async function seedTokenEntitlement(params: {
  userId: string;
  limit: number;
  used: number;
  permanentLimit?: number;
}) {
  const entitlementRepo = new DynamoEntitlementRepository(
    TABLE_NAMES.entitlements,
    docClient(),
  );

  const entitlement = new Entitlement(
    params.userId,
    "token" as EntitlementKey,
    "learner",
    EntitlementStatus.ACTIVE,
    new Date(),
    undefined,
    new EntitlementUsage(
      params.limit,
      params.used,
      undefined,
      undefined,
      params.permanentLimit ?? 0,
    ),
  );

  await entitlementRepo.save(entitlement);
  return entitlement;
}

describe("Token Service E2E", () => {
  let productRepo: DynamoProductRepository;
  let entitlementRepo: DynamoEntitlementRepository;

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-secret";

    const tokenMod = await import("../../services/token-service/src/handler");
    tokenHandler = tokenMod.handler;

    const accessMod = await import("../../services/access-service/src/handler");
    accessHandler = accessMod.handler;

    productRepo = new DynamoProductRepository();
    entitlementRepo = new DynamoEntitlementRepository(
      TABLE_NAMES.entitlements,
      docClient(),
    );
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
    await clearTable(TABLE_NAMES.prices);
    await clearTable(TABLE_NAMES.entitlements);
    await clearTable(TABLE_NAMES.processedEvents, ["eventId"]);
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  describe("happy path", () => {
    it("charges tokens and grants access immediately", async () => {
      const userId = `user-${Date.now()}`;
      const productId = `product-${Date.now()}`;
      const priceId = `price-${Date.now()}`;

      await createProduct(productRepo, [], {
        productId,
        name: "Token Purchase Product",
        type: ProductType.ONE_OFF,
        entitlements: [EntitlementKey.SUBJECT_ACCESS],
        usageLimits: [
          {
            metric: EntitlementKey.SUBJECT_ACCESS,
            limit: 25,
            period: "lifetime",
          },
        ],
        isActive: true,
      });

      await seedPrice({
        priceId,
        productId,
        amount: 30,
        currency: "token",
      });

      await seedTokenEntitlement({
        userId,
        limit: 100,
        used: 20,
      });

      const token = createJwtWithRole("learner", userId);

      const result = await tokenHandler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/token/charge",
          resource: "/token/charge",
          headers: authHeaders(token),
          body: JSON.stringify({ priceId }),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.amount).toBe(30);
      expect(body.remainingTokens).toBe(50);
      expect(body.paymentIntentId).toContain("token_");

      const tokenEntitlement = await entitlementRepo.findByUserAndKey(
        userId,
        "token",
      );
      expect(tokenEntitlement?.usage?.used).toBe(50);

      const accessResult = await accessHandler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(accessResult.statusCode).toBe(200);

      const accessBody = JSON.parse(accessResult.body);
      expect(accessBody.userId).toBe(userId);
      expect(
        accessBody.entitlements[EntitlementKey.SUBJECT_ACCESS],
      ).toMatchObject({
        limit: 25,
        used: 0,
      });
    });
  });

  describe("idempotency", () => {
    it("does not double charge when the same idempotency key is reused", async () => {
      const userId = `user-${Date.now()}`;
      const productId = `product-${Date.now()}`;
      const priceId = `price-${Date.now()}`;
      const idempotencyKey = `idem-${Date.now()}`;

      await createProduct(productRepo, [], {
        productId,
        name: "Idempotent Token Product",
        type: ProductType.ONE_OFF,
        entitlements: [EntitlementKey.SUBJECT_ACCESS],
        usageLimits: [
          {
            metric: EntitlementKey.SUBJECT_ACCESS,
            limit: 25,
            period: "lifetime",
          },
        ],
        isActive: true,
      });

      await seedPrice({
        priceId,
        productId,
        amount: 30,
        currency: "token",
      });

      await seedTokenEntitlement({
        userId,
        limit: 100,
        used: 20,
      });

      const token = createJwtWithRole("learner", userId);

      const event = createApiGatewayEvent({
        httpMethod: "POST",
        path: "/token/charge",
        resource: "/token/charge",
        headers: authHeaders(token, { "Idempotency-Key": idempotencyKey }),
        body: JSON.stringify({ priceId }),
      });

      const first = await tokenHandler(event);
      const second = await tokenHandler(event);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const firstBody = JSON.parse(first.body);
      const secondBody = JSON.parse(second.body);

      expect(secondBody.paymentIntentId).toBe(firstBody.paymentIntentId);
      expect(secondBody.amount).toBe(30);

      const tokenEntitlement = await entitlementRepo.findByUserAndKey(
        userId,
        "token",
      );
      expect(tokenEntitlement?.usage?.used).toBe(50);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when the same user makes a second token purchase immediately", async () => {
      const userId = `user-${Date.now()}`;
      const productId = `product-${Date.now()}`;
      const priceId = `price-${Date.now()}`;

      await createProduct(productRepo, [], {
        productId,
        name: "Rate Limited Token Product",
        type: ProductType.ONE_OFF,
        entitlements: [EntitlementKey.SUBJECT_ACCESS],
        usageLimits: [
          {
            metric: EntitlementKey.SUBJECT_ACCESS,
            limit: 25,
            period: "lifetime",
          },
        ],
        isActive: true,
      });

      await seedPrice({
        priceId,
        productId,
        amount: 10,
        currency: "token",
      });

      await seedTokenEntitlement({
        userId,
        limit: 100,
        used: 20,
      });

      const token = createJwtWithRole("learner", userId);

      const first = await tokenHandler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/token/charge",
          resource: "/token/charge",
          headers: authHeaders(token, {
            "Idempotency-Key": `idem-a-${Date.now()}`,
          }),
          body: JSON.stringify({ priceId }),
        }),
      );

      expect(first.statusCode).toBe(200);

      const second = await tokenHandler(
        createApiGatewayEvent({
          httpMethod: "POST",
          path: "/token/charge",
          resource: "/token/charge",
          headers: authHeaders(token, {
            "Idempotency-Key": `idem-b-${Date.now()}`,
          }),
          body: JSON.stringify({ priceId }),
        }),
      );

      expect(second.statusCode).toBe(429);
      const body = JSON.parse(second.body);
      expect(body.error).toBe("RATE_LIMITED");

      const tokenEntitlement = await entitlementRepo.findByUserAndKey(
        userId,
        "token",
      );
      expect(tokenEntitlement?.usage?.used).toBe(30);
    });
  });
});
