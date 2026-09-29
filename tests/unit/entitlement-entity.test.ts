import {
  Entitlement,
  EntitlementKey,
  EntitlementStatus,
} from "@libs/domain";

describe("Entitlement Entity", () => {
  function makeEntitlement(overrides?: {
    userId?: string;
    key?: EntitlementKey;
    role?: string;
    status?: EntitlementStatus;
    grantedAt?: Date;
    expiresAt?: Date;
  }) {
    return new Entitlement(
      overrides?.userId ?? "user-001",
      overrides?.key ?? EntitlementKey.SUBJECT_ACCESS,
      overrides?.role ?? "learner",
      overrides?.status ?? EntitlementStatus.ACTIVE,
      overrides?.grantedAt ?? new Date("2025-01-01"),
      overrides?.expiresAt,
      undefined
    );
  }

  describe("isActive", () => {
    it("should return true for an active entitlement without expiry", () => {
      const entitlement = makeEntitlement();
      expect(entitlement.isActive()).toBe(true);
    });

    it("should return false for a revoked entitlement", () => {
      const entitlement = makeEntitlement({ status: EntitlementStatus.REVOKED });
      expect(entitlement.isActive()).toBe(false);
    });

    it("should return false for an expired entitlement", () => {
      const entitlement = makeEntitlement({ status: EntitlementStatus.EXPIRED });
      expect(entitlement.isActive()).toBe(false);
    });

    it("should return true when expiry is in the future", () => {
      const future = new Date(Date.now() + 86400000);
      const entitlement = makeEntitlement({ expiresAt: future });
      expect(entitlement.isActive()).toBe(true);
    });

    it("should return false when expiry is in the past", () => {
      const past = new Date("2020-01-01");
      const entitlement = makeEntitlement({ expiresAt: past });
      expect(entitlement.isActive()).toBe(false);
    });
  });

  describe("properties", () => {
    it("should store userId, key, role, and status", () => {
      const entitlement = makeEntitlement();
      expect(entitlement.userId).toBe("user-001");
      expect(entitlement.key).toBe(EntitlementKey.SUBJECT_ACCESS);
      expect(entitlement.role).toBe("learner");
      expect(entitlement.status).toBe(EntitlementStatus.ACTIVE);
    });

    it("should store grantedAt date", () => {
      const entitlement = makeEntitlement();
      expect(entitlement.grantedAt).toEqual(new Date("2025-01-01"));
    });
  });
});
