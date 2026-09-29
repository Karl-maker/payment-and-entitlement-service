import type { ProductPurchaseIntent } from "../../domain/entities/product-purchase-intent.entity";

export interface ProductPurchaseIntentRepository {
  findById(id: string): Promise<ProductPurchaseIntent | null>;
  findByUserId(userId: string, limit?: number): Promise<ProductPurchaseIntent[]>;
  save(intent: ProductPurchaseIntent): Promise<void>;
}
