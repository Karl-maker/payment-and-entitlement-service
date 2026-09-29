import { BillingEvent } from "@libs/domain";

const EntitlementEventType = BillingEvent.EntitlementEventType;
type EntitlementAvailabilityPayload = BillingEvent.EntitlementAvailabilityPayload;
type EntitlementAvailabilityUpdatedEvent = BillingEvent.EntitlementAvailabilityUpdatedEvent;

describe("Entitlement Availability Updated Event", () => {
  it("should have event type entitlement.availability_updated", () => {
    expect(EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED).toBe(
      "entitlement.availability_updated"
    );
  });

  it("payload should require userId, key, and currentAvailableUsage", () => {
    const payload: EntitlementAvailabilityPayload = {
      userId: "user-123",
      key: "token",
      currentAvailableUsage: 42,
    };
    expect(payload.userId).toBe("user-123");
    expect(payload.key).toBe("token");
    expect(payload.currentAvailableUsage).toBe(42);
  });

  it("payload should allow null currentAvailableUsage for non-usage entitlements", () => {
    const payload: EntitlementAvailabilityPayload = {
      userId: "user-456",
      key: "subject_access",
      currentAvailableUsage: null,
    };
    expect(payload.currentAvailableUsage).toBeNull();
  });

  it("full event should have type, payload, meta, and version", () => {
    const event: EntitlementAvailabilityUpdatedEvent = {
      type: EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED,
      payload: {
        userId: "user-789",
        key: "token",
        currentAvailableUsage: 10,
      },
      meta: {
        eventId: "evt-1",
        occurredAt: "2025-01-15T12:00:00.000Z",
        source: "internal",
      },
      version: 1,
    };
    expect(event.type).toBe("entitlement.availability_updated");
    expect(event.payload.userId).toBe("user-789");
    expect(event.payload.key).toBe("token");
    expect(event.payload.currentAvailableUsage).toBe(10);
    expect(event.meta.source).toBe("internal");
    expect(event.version).toBe(1);
  });
});
