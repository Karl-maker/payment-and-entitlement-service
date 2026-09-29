import { BillingEvent } from "@libs/domain";

export type BillingDomainEvent<TPayload = any> =
  BillingEvent.BillingDomainEvent<TPayload>;

export type BillingEventMetadata = BillingEvent.BillingEventMetadata;

export function createBillingMeta(
  meta: Partial<BillingEventMetadata> = {},
): BillingEventMetadata {
  return {
    eventId: `evt-${Date.now()}`,
    occurredAt: new Date().toISOString(),
    source: "internal",
    ...meta,
  };
}

export function createBillingDomainEvent<TPayload>(
  type: string,
  payload: TPayload,
  meta: BillingEventMetadata = createBillingMeta(),
): BillingDomainEvent<TPayload> {
  return {
    type,
    payload,
    meta,
    version: 1,
  } as BillingDomainEvent<TPayload>;
}
