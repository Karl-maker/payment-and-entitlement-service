import { jest } from "@jest/globals";
import {
  Entitlement,
  EntitlementKey,
  EntitlementRole,
  EntitlementStatus,
  EntitlementUsage,
  DynamoEntitlementRepository,
} from "@libs/domain";
import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
  docClient,
} from "../helpers/localstack";
import { createApiGatewayEvent } from "../helpers/fixtures";
import {
  createJwtWithRole,
  createExpiredJwt,
} from "../helpers/jwt-test-helper";
import { handler } from "../../services/access-service/src/handler";

function authHeaders(token: string) {
  return {
    ...createApiGatewayEvent().headers,
    Authorization: `Bearer ${token}`,
  };
}

describe("Access Service End-to-End Tests", () => {
  let entitlementRepo: DynamoEntitlementRepository;

  const userId = `user-${Date.now()}`;
  beforeAll(async () => {
    setTestEnvVars();
    await createAllTables();
    process.env.JWT_ACCESS_TOKEN_SECRET =
      process.env.JWT_ACCESS_TOKEN_SECRET || "test-jwt-secret-for-e2e";
    entitlementRepo = new DynamoEntitlementRepository(TABLE_NAMES.entitlements);
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.entitlements);
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  async function createEntitlement(params: {
    key: EntitlementKey;
    status?: EntitlementStatus;
    expiresAt?: Date;
    usage?: EntitlementUsage;
    role?: EntitlementRole;
  }) {
    const entitlement = new Entitlement(
      userId,
      params.key,
      params.role ?? ("learner" as EntitlementRole),
      params.status ?? EntitlementStatus.ACTIVE,
      new Date(),
      params.expiresAt,
      params.usage,
    );

    await entitlementRepo.save(entitlement);
    return entitlement;
  }

  describe("GET /access", () => {
    it("returns access for valid JWT", async () => {
      const entitlement = await new Entitlement(
        userId,
        EntitlementKey.SUBJECT_ACCESS,
        "learner" as EntitlementRole,
        EntitlementStatus.ACTIVE,
        new Date(),
      );

      await entitlementRepo.save(entitlement);

      const entitlement2 = await new Entitlement(
        userId,
        EntitlementKey.QUESTION_GENERATION,
        "learner" as EntitlementRole,
        EntitlementStatus.ACTIVE,
        new Date(),
        undefined,
        new EntitlementUsage(100, 25),
      );
      await entitlementRepo.save(entitlement2);

      const token = createJwtWithRole("learner", userId);
      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.userId).toBe(userId);
      expect(body.entitlements[EntitlementKey.SUBJECT_ACCESS]).toBe(true);
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toMatchObject({
        limit: 100,
        used: 25,
      });
    });

    it("returns 401 for missing JWT", async () => {
      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
        }),
      );
      expect(result.statusCode).toBe(401);
    });

    it("returns 401 when JWT is invalid", async () => {
      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders("not-a-valid-token"),
        }),
      );

      expect(result.statusCode).toBe(401);
    });

    it("returns 401 when JWT is expired", async () => {
      const token = createExpiredJwt("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(401);
    });

    it("resets usage on retrieval when reset is due", async () => {
      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.QUESTION_GENERATION,
          "learner" as EntitlementRole,
          EntitlementStatus.ACTIVE,
          new Date(),
          undefined,
          new EntitlementUsage(100, 77, new Date(Date.now() - 60_000), {
            type: "periodic",
            period: "day",
            hour: 0,
          }),
        ),
      );

      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toMatchObject({
        limit: 100,
        used: 0,
      });

      const saved = await entitlementRepo.findByUserAndKey(
        userId,
        EntitlementKey.QUESTION_GENERATION,
      );
      expect(saved?.usage?.used).toBe(0);
    });

    it("does not reset usage when reset is not due", async () => {
      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.QUESTION_GENERATION,
          "learner" as EntitlementRole,
          EntitlementStatus.ACTIVE,
          new Date(),
          undefined,
          new EntitlementUsage(
            100,
            12,
            new Date(Date.now() + 24 * 60 * 60 * 1000),
            {
              type: "periodic",
              period: "day",
              hour: 0,
            },
          ),
        ),
      );

      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toMatchObject({
        limit: 100,
        used: 12,
      });
    });

    it("calculates correct limit with permanentLimit", async () => {
      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.QUESTION_GENERATION,
          "learner" as EntitlementRole,
          EntitlementStatus.ACTIVE,
          new Date(),
          undefined,
          new EntitlementUsage(100, 20, undefined, undefined, 50),
        ),
      );

      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toMatchObject({
        limit: 150,
        used: 20,
      });
    });

    it("filters inactive and expired entitlements", async () => {
      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.ADVANCED_ANALYTICS,
          "learner" as EntitlementRole,
          EntitlementStatus.EXPIRED,
          new Date(),
        ),
      );

      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.QUESTION_GENERATION,
          "learner" as EntitlementRole,
          EntitlementStatus.ACTIVE,
          new Date(),
          new Date(Date.now() - 60_000),
          new EntitlementUsage(100, 5),
        ), // make it expire after and not be active, so it would be undefined
      );

      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(
        body.entitlements[EntitlementKey.ADVANCED_ANALYTICS],
      ).toBeUndefined();
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toBeUndefined();
    });

    it("handles many records within the performance budget", async () => {
      jest.setTimeout(30000);

      for (let i = 0; i < 250; i++) {
        await entitlementRepo.save(
          new Entitlement(
            userId,
            `QUESTION_GENERATION_${i}` as EntitlementKey,
            "learner" as EntitlementRole,
            EntitlementStatus.ACTIVE,
            new Date(),
            undefined,
            new EntitlementUsage(100, i % 10),
          ),
        );
      }

      const token = createJwtWithRole("learner", userId);

      const startedAt = Date.now();
      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access",
          resource: "/access",
          headers: authHeaders(token),
        }),
      );
      const durationMs = Date.now() - startedAt;

      expect(result.statusCode).toBe(200);
      expect(durationMs).toBeLessThan(2000);
    });
  });

  describe("GET /access/:key", () => {
    it("returns a single entitlement by key for a valid JWT", async () => {
      await entitlementRepo.save(
        new Entitlement(
          userId,
          EntitlementKey.QUESTION_GENERATION,
          "learner" as EntitlementRole,
          EntitlementStatus.ACTIVE,
          new Date(),
          undefined,
          new EntitlementUsage(100, 25),
        ),
      );

      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access/question_generation",
          resource: "/access/{key}",
          pathParameters: { key: EntitlementKey.QUESTION_GENERATION },
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.userId).toBe(userId);
      expect(
        body.entitlements[EntitlementKey.QUESTION_GENERATION],
      ).toMatchObject({
        limit: 100,
        used: 25,
      });
    });

    it("returns 404 when the entitlement does not exist", async () => {
      const token = createJwtWithRole("learner", userId);

      const result = await handler(
        createApiGatewayEvent({
          httpMethod: "GET",
          path: "/access/question_generation",
          resource: "/access/{key}",
          pathParameters: { key: EntitlementKey.QUESTION_GENERATION },
          headers: authHeaders(token),
        }),
      );

      expect(result.statusCode).toBe(404);
    });
  });
});
