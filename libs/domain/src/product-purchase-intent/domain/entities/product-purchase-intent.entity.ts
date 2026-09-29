import type { ProductPurchaseIntentItem } from "./product-purchase-intent-item.entity";

export type ProductPurchaseIntentStatus = "pending_payment" | "completed" | "expired" | "cancelled";

export class ProductPurchaseIntent {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly items: ProductPurchaseIntentItem[],
    public readonly subtotal: number,
    public readonly tax: number,
    public readonly discount: number,
    public readonly total: number,
    public readonly currency: string,
    public readonly status: ProductPurchaseIntentStatus,
    public readonly expiresAt: Date,
    public readonly createdAt: Date
  ) {}
}
