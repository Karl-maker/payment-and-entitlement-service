import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  docClient,
  TABLE_NAMES,
} from "../helpers/localstack";
import {
  DynamoEntitlementRepository,
  Entitlement,
  EntitlementKey,
  EntitlementStatus,
  EntitlementUsage,
} from "@libs/domain";

describe("DynamoEntitlementRepository (LocalStack)", () => {
  let repo: DynamoEntitlementRepository;

  beforeAll(async () => {
    await createAllTables();
    setTestEnvVars();
    repo = new DynamoEntitlementRepository(TABLE_NAMES.entitlements, docClient());
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.entitlements);
  });

  describe("save + findByUser", () => {
    it("should save and retrieve an entitlement", async () => {
      const entitlement = new Entitlement(
        "user-int-1",
        EntitlementKey.SUBJECT_ACCESS,
        "learner",
        EntitlementStatus.ACTIVE,
        new Date("2025-01-01")
      );

      await repo.save(entitlement);
      const results = await repo.findByUser("user-int-1");

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe("user-int-1");
      expect(results[0].key).toBe(EntitlementKey.SUBJECT_ACCESS);
      expect(results[0].status).toBe(EntitlementStatus.ACTIVE);
    });

    it("should return empty array for unknown user", async () => {
      const results = await repo.findByUser("nonexistent");
      expect(results).toEqual([]);
    });
  });

  describe("findByUserAndKey", () => {
    it("should find a specific entitlement by user and key", async () => {
      const entitlement = new Entitlement(
        "user-int-2",
        EntitlementKey.AI_TUTOR_ACCESS,
        "learner",
        EntitlementStatus.ACTIVE,
        new Date()
      );

      await repo.save(entitlement);
      const found = await repo.findByUserAndKey("user-int-2", EntitlementKey.AI_TUTOR_ACCESS);

      expect(found).not.toBeNull();
      expect(found!.key).toBe(EntitlementKey.AI_TUTOR_ACCESS);
    });

    it("should return null for non-existent key", async () => {
      const found = await repo.findByUserAndKey("user-int-2", EntitlementKey.ADVANCED_ANALYTICS);
      expect(found).toBeNull();
    });
  });

  describe("save with usage", () => {
    it("should persist usage data", async () => {
      const usage = new EntitlementUsage(100, 25, undefined, undefined, 0);
      const entitlement = new Entitlement(
        "user-int-3",
        EntitlementKey.QUESTION_GENERATION,
        "learner",
        EntitlementStatus.ACTIVE,
        new Date(),
        undefined,
        usage
      );

      await repo.save(entitlement);
      const found = await repo.findByUserAndKey("user-int-3", EntitlementKey.QUESTION_GENERATION);

      expect(found).not.toBeNull();
      expect(found!.usage).toBeDefined();
      expect(found!.usage!.limit).toBe(100);
      expect(found!.usage!.used).toBe(25);
    });
  });

  describe("deleteByUserAndKey", () => {
    it("should delete a specific entitlement", async () => {
      const entitlement = new Entitlement(
        "user-int-4",
        EntitlementKey.CLASSROOM_ACCESS,
        "learner",
        EntitlementStatus.ACTIVE,
        new Date()
      );

      await repo.save(entitlement);
      const deleted = await repo.deleteByUserAndKey("user-int-4", EntitlementKey.CLASSROOM_ACCESS);
      expect(deleted).toBe(true);

      const found = await repo.findByUserAndKey("user-int-4", EntitlementKey.CLASSROOM_ACCESS);
      expect(found).toBeNull();
    });

    it("should return false for non-existent entitlement", async () => {
      const deleted = await repo.deleteByUserAndKey("nobody", EntitlementKey.CLASSROOM_ACCESS);
      expect(deleted).toBe(false);
    });
  });
});
