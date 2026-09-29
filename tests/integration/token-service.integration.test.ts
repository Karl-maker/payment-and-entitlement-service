import {
  BillingType,
  DynamoEntitlementRepository,
  DynamoPriceRepository,
  DynamoProductRepository,
  Entitlement,
  EntitlementKey,
  EntitlementRole,
  EntitlementStatus,
  EntitlementUsage,
  Product,
  ProductType,
  Price,
  type ProductRepositoryPorts,
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
let handler: (event: APIGatewayProxyEvent) => Promise<any>;

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

describe("Token Service Integration Tests", () => {
  let productRepo: ProductRepositoryPorts.ProductRepository;
  let entitlementRepo: DynamoEntitlementRepository;

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-secret";

    const mod = await import("../../services/token-service/src/handler");
    handler = mod.handler;

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
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  it("charges tokens and grants access immediately when user has enough tokens", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const priceId = `price-${Date.now()}`;

    await createProduct(productRepo, [], {
      productId,
      name: "Test Product",
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

    const result = await handler(
      createApiGatewayEvent({
        httpMethod: "POST",
        path: "/token/charge",
        resource: "/token/charge",
        headers: authHeaders(token),
        body: JSON.stringify({
          priceId,
        }),
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
    expect(tokenEntitlement).toBeDefined();
    expect(tokenEntitlement?.usage?.used).toBe(50);

    const productEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );
    expect(productEntitlement).toBeDefined();
    expect(productEntitlement?.status).toBe(EntitlementStatus.ACTIVE);
    expect(productEntitlement?.usage).toBeDefined();
    expect(productEntitlement?.usage?.limit).toBe(0);
    expect(productEntitlement?.usage?.permanentLimit).toBe(25);
  });

  it("activates an existing product entitlement immediately", async () => {
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
      amount: 10,
      currency: "token",
    });

    await seedTokenEntitlement({
      userId,
      limit: 100,
      used: 10,
    });

    await entitlementRepo.save(
      new Entitlement(
        userId,
        EntitlementKey.SUBJECT_ACCESS,
        "learner",
        EntitlementStatus.REVOKED,
        new Date(),
      ),
    );

    const token = createJwtWithRole("learner", userId);

    const result = await handler(
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

    const productEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      EntitlementKey.SUBJECT_ACCESS,
    );
    expect(productEntitlement).toBeDefined();
    expect(productEntitlement?.status).toBe(EntitlementStatus.ACTIVE);
  });

  it("rejects a non-token currency", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const priceId = `price-${Date.now()}`;

    await createProduct(productRepo, [], {
      productId,
      name: "USD Product",
      type: ProductType.ONE_OFF,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      isActive: true,
    });

    await seedPrice({
      priceId,
      productId,
      amount: 30,
      currency: "usd",
    });

    await seedTokenEntitlement({
      userId,
      limit: 100,
      used: 20,
    });

    const token = createJwtWithRole("learner", userId);

    const result = await handler(
      createApiGatewayEvent({
        httpMethod: "POST",
        path: "/token/charge",
        resource: "/token/charge",
        headers: authHeaders(token),
        body: JSON.stringify({ priceId }),
      }),
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("DOMAIN_ERROR");
    expect(body.message).toContain("does not use token currency");
  });

  it("rejects when the token entitlement is missing", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const priceId = `price-${Date.now()}`;

    await createProduct(productRepo, [], {
      productId,
      name: "Token Purchase Product",
      type: ProductType.ONE_OFF,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      isActive: true,
    });

    await seedPrice({
      priceId,
      productId,
      amount: 10,
      currency: "token",
    });

    const token = createJwtWithRole("learner", userId);

    const result = await handler(
      createApiGatewayEvent({
        httpMethod: "POST",
        path: "/token/charge",
        resource: "/token/charge",
        headers: authHeaders(token),
        body: JSON.stringify({ priceId }),
      }),
    );

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toContain("Token entitlement not found");
  });

  it("rejects when the token balance is insufficient", async () => {
    const userId = `user-${Date.now()}`;
    const productId = `product-${Date.now()}`;
    const priceId = `price-${Date.now()}`;

    await createProduct(productRepo, [], {
      productId,
      name: "Token Purchase Product",
      type: ProductType.ONE_OFF,
      entitlements: [EntitlementKey.SUBJECT_ACCESS],
      isActive: true,
    });

    await seedPrice({
      priceId,
      productId,
      amount: 500,
      currency: "token",
    });

    await seedTokenEntitlement({
      userId,
      limit: 100,
      used: 20,
    });

    const token = createJwtWithRole("learner", userId);

    const result = await handler(
      createApiGatewayEvent({
        httpMethod: "POST",
        path: "/token/charge",
        resource: "/token/charge",
        headers: authHeaders(token),
        body: JSON.stringify({ priceId }),
      }),
    );

    expect(result.statusCode).toBe(402);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("PAYMENT_REQUIRED");
    expect(body.message).toContain("Insufficient tokens");
  });

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
      headers: authHeaders(token, {
        "Idempotency-Key": idempotencyKey,
      }),
      body: JSON.stringify({ priceId }),
    });

    const first = await handler(event);
    const second = await handler(event);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);

    expect(secondBody.paymentIntentId).toBe(firstBody.paymentIntentId);
    expect(secondBody.amount).toBe(30);
    expect(secondBody.remainingTokens).toBe(50);

    const tokenEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      "token",
    );
    expect(tokenEntitlement?.usage?.used).toBe(50);
  });

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

    const first = await handler(
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

    const second = await handler(
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
    expect(body.message).toContain("rate limited");

    const tokenEntitlement = await entitlementRepo.findByUserAndKey(
      userId,
      "token",
    );
    expect(tokenEntitlement?.usage?.used).toBe(30);
  });
});
