export type TransactionType = 
  | "payment.successful"
  | "payment.failed"
  | "payment.action_required"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.expired";

export type TransactionStatus = "success" | "failed" | "pending" | "action_required";
export type TransactionProvider = "stripe" | "powertranz";

export class Transaction {
  constructor(
    public readonly transactionId: string, // Unique transaction ID (e.g., paymentIntentId, subscriptionId)
    public readonly userId: string,
    public readonly type: TransactionType,
    public readonly status: TransactionStatus,
    public readonly amount: number,
    public readonly currency: string,
    public readonly createdAt: Date,
    public readonly productId?: string,
    public readonly priceId?: string,
    public readonly subscriptionId?: string,
    public readonly provider?: TransactionProvider,
    public readonly metadata?: Record<string, any> // Additional event-specific data
  ) {}

  static fromBillingEvent(
    eventType: TransactionType,
    payload: any,
    eventId: string
  ): Transaction {
    const status = mapEventTypeToStatus(eventType, payload);
    const amount = payload.amount || 0;
    const currency = payload.currency || "USD";
    const provider = normalizeTransactionProvider(payload.provider);

    return new Transaction(
      payload.paymentIntentId || payload.subscriptionId || eventId,
      payload.userId,
      eventType,
      status,
      amount,
      currency,
      new Date(),
      payload.productId,
      payload.priceId,
      payload.subscriptionId,
      provider,
      {
        eventId,
        provider,
        failureCode: payload.failureCode,
        failureReason: payload.failureReason,
        portalUrl: payload.portalUrl,
        expiresAt: payload.expiresAt,
        billingType: payload.billingType,
        addonProductIds: payload.addonProductIds,
        previousProductId: payload.previousProductId,
      }
    );
  }
}

function normalizeTransactionProvider(
  provider: unknown
): TransactionProvider | undefined {
  if (provider !== "stripe" && provider !== "powertranz") {
    return undefined;
  }

  return provider;
}

function mapEventTypeToStatus(
  eventType: TransactionType,
  payload: any
): TransactionStatus {
  switch (eventType) {
    case "payment.successful":
      return "success";
    case "payment.failed":
      return "failed";
    case "payment.action_required":
      return "action_required";
    case "subscription.created":
    case "subscription.updated":
      return payload.status === "active" ? "success" : "pending";
    case "subscription.canceled":
      return "pending"; // Still active until period end
    case "subscription.expired":
      return "failed";
    default:
      return "pending";
  }
}
