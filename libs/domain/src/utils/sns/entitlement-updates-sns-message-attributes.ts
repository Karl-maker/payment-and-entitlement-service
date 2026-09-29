/**
 * Message attributes for SNS publishes to the entitlement updates topic.
 * SNS subscription filter policies (e.g. SQS subscribers) can filter on these;
 * each event carries a single entitlement key in both the JSON payload and `entitlementKey`.
 */
export function entitlementUpdatesSnsMessageAttributes(
  eventType: string,
  entitlementKey: string,
) {
  return {
    eventType: {
      DataType: "String" as const,
      StringValue: eventType,
    },
    entitlementKey: {
      DataType: "String" as const,
      StringValue: entitlementKey,
    },
  };
}
