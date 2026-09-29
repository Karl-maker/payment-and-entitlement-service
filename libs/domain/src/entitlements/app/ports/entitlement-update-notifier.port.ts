import type { Entitlement } from "../../domain/entities/entitlement.entity";

/**
 * Optional port to notify when an entitlement is updated (e.g. publish to SNS).
 * Used after repo.update() so subscribers get key, user, and current available usage.
 */
export interface EntitlementUpdateNotifier {
  notify(entitlement: Entitlement): Promise<void>;
}
