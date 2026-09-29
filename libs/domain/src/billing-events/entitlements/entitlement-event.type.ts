export enum EntitlementEventType {
  ENTITLEMENT_CREATED = "entitlement.created",
  ENTITLEMENT_UPDATED = "entitlement.updated",
  ENTITLEMENT_REVOKED = "entitlement.revoked",
  /** Fired when usage/limit changes (increase, decrease, reset). Payload: key, userId, currentAvailableUsage */
  ENTITLEMENT_AVAILABILITY_UPDATED = "entitlement.availability_updated",
}
