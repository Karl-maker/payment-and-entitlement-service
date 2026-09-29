import { ProductRepository } from "../ports/product.repository.port";
import { ProductType } from "../../domain/value-objects/product-type.vo";

export class SearchProductsUseCase {
  constructor(private readonly repo: ProductRepository) {}

  async execute(input: {
    pageNumber: number;
    pageSize: number;
    namePrefix?: string;
    type?: ProductType;
    isActive?: boolean;
    userId?: string;
    country?: string;
    ipAddress?: string;
  }) {
    return this.repo.list(
      {
        type: input.type,
        isActive: input.isActive,
        namePrefix: input.namePrefix,
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
}
