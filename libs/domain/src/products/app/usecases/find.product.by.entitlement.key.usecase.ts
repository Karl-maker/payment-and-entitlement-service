import { Product } from "../../domain/entities/product.entity";
import { ProductRepository } from "../ports/product.repository.port";
import { ProductType } from "../../domain/value-objects/product-type.vo";

export interface ProductByEntitlementDto {
  productId: string;
  name: string;
  description?: string;
  type: string;
  entitlements: string[];
  usageLimits?: any[];
  addons?: string[];
  addonConfigs?: any[];
  providers?: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class FindProductByEntitlementKeyUseCase {
  constructor(private readonly repo: ProductRepository) {}

  /**
   * Search ALL product types (subscription, one_off, addon) and return ALL products
   * that include the given entitlement key. Returns empty array if none match.
   */
  async execute(
    entitlementKey: string,
    context?: {
      userId?: string;
      country?: string;
      ipAddress?: string;
    },
  ): Promise<ProductByEntitlementDto[]> {
    const types: ProductType[] = [
      ProductType.SUBSCRIPTION,
      ProductType.ONE_OFF,
      ProductType.ADDON,
    ];
    const pageSize = 100;
    const all: ProductByEntitlementDto[] = [];

    for (const productType of types) {
      let pageNumber = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await this.repo.list(
          {
            isActive: true,
            type: productType,
            entitlementKey,
            userId: context?.userId,
            country: context?.country,
            ipAddress: context?.ipAddress,
          },
          { pageNumber, pageSize },
        );
        for (const p of result.items) {
          all.push(this.toDto(p));
        }
        hasMore = result.items.length === pageSize;
        pageNumber++;
      }
    }

    return all;
  }

  private toDto(p: Product): ProductByEntitlementDto {
    return {
      productId: p.productId,
      name: p.name,
      description: p.description,
      type: p.type,
      entitlements: p.entitlements,
      usageLimits: p.usageLimits,
      addons: p.addons,
      addonConfigs: p.addonConfigs,
      providers: p.providers,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
