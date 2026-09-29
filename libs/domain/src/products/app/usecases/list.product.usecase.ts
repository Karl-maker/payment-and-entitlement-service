import { ProductRepository } from "../ports/product.repository.port";
import { ProductType } from "../../domain/value-objects/product-type.vo";

export class ListProductsUseCase {
  constructor(private readonly repo: ProductRepository) {}

  async execute(input: {
    pageNumber: number;
    pageSize: number;
    type?: ProductType;
    isActive?: boolean;
    entitlementKey?: string;
    userId?: string;
    country?: string;
    ipAddress?: string;
  }) {
    // Normalize entitlement_key: kebab-case in URL -> snake_case (e.g. ai-tutor-access -> ai_tutor_access)
    const entitlementKey = input.entitlementKey
      ? input.entitlementKey.replace(/-/g, "_")
      : undefined;

    const shouldSearchAllTypes =
      input.type === undefined &&
      (entitlementKey !== undefined || input.isActive !== undefined); // include the isActive flag

    // When filtering by entitlement_key without type, search all types and merge into one page
    if (shouldSearchAllTypes) {
      const types: ProductType[] = [
        ProductType.SUBSCRIPTION,
        ProductType.ONE_OFF,
        ProductType.ADDON,
      ];
      const results = await Promise.all(
        types.map((type) =>
          this.listAllByType({
            type,
            isActive: input.isActive,
            entitlementKey,
            userId: input.userId,
            country: input.country,
            ipAddress: input.ipAddress,
          }),
        ),
      );
      const merged = results
        .flat()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const start = (input.pageNumber - 1) * input.pageSize;
      return {
        items: merged.slice(start, start + input.pageSize),
        total: merged.length,
        pageNumber: input.pageNumber,
        pageSize: input.pageSize,
      };
    }

    return this.repo.list(
      {
        type: input.type,
        isActive: input.isActive,
        entitlementKey,
        userId: input.userId,
        country: input.country,
        ipAddress: input.ipAddress,
      },
      {
        pageNumber: input.pageNumber,
        pageSize: input.pageSize,
      },
    );
  }

  private async listAllByType(filters: {
    type: ProductType;
    isActive?: boolean;
    entitlementKey?: string;
    userId?: string;
    country?: string;
    ipAddress?: string;
  }) {
    const pageSize = 100;
    const items = [];
    let pageNumber = 1;

    while (true) {
      const result = await this.repo.list(filters, { pageNumber, pageSize });
      items.push(...result.items);

      if (result.items.length < pageSize) {
        break;
      }
      pageNumber++;
    }
    return items;
  }
}
