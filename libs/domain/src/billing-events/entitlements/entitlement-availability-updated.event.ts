import { BillingDomainEvent } from "../base/domain-event";
import { EntitlementEventType } from "./entitlement-event.type";

/**
 * Payload for entitlement availability updates (usage increased, decreased, reset, or limit changed).
 * Published whenever an entitlement's "current available usage" changes.
 */
export interface EntitlementAvailabilityPayload {
  /** User ID owning the entitlement */
  userId: string;
  /** Entitlement key (e.g. "token", "subject_access") */
  key: string;
  /** Current available usage: limit - used. Null if entitlement is not usage-based. */
  currentAvailableUsage: number | null;
}

export type EntitlementAvailabilityUpdatedEvent = BillingDomainEvent<EntitlementAvailabilityPayload> & {
  type: EntitlementEventType.ENTITLEMENT_AVAILABILITY_UPDATED;
};
