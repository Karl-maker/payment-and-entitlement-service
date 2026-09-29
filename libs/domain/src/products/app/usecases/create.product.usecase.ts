import { ProductRepository } from "../ports/product.repository.port";
import { Product } from "../../domain/entities/product.entity";
import { ProductType } from "../../domain/value-objects/product-type.vo";
import { randomUUID } from "crypto";

export class CreateProductUseCase {
  constructor(private readonly repo: ProductRepository) {}

  async execute(input: any) {
    const isActive =
      input.isActive !== undefined
        ? Boolean(input.isActive)
        : input.deactivated !== undefined
          ? !Boolean(input.deactivated)
          : true;

    const targeting = input.targeting ?? this.buildTargetingFromInput(input);
    const product = Product.create({
      productId: randomUUID(),
      name: input.name,
      description: input.description,
      type: input.type as ProductType,
      entitlements: input.entitlements,
      usageLimits: input.usageLimits,
      addons: input.addons,
      providers: input.providers,
      targeting,
      isActive,
    });

    await this.repo.create(product);

    return {
      productId: product.productId,
    };
  }

  private buildTargetingFromInput(input: any) {
    const targeting = {
      countries: input.countries,
      percentage: input.percentage,
      cidrBlocks: input.cidrBlocks,
    };

    if (
      targeting.countries === undefined &&
      targeting.percentage === undefined &&
      targeting.cidrBlocks === undefined
    ) {
      return undefined;
    }

    return targeting;
  }
}
