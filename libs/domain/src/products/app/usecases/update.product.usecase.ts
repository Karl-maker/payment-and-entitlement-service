import { ProductRepository } from "../ports/product.repository.port";
import { NotFoundError } from "../../domain/errors/not-found.error";
import { ProductType } from "../../domain/value-objects/product-type.vo";

export class UpdateProductUseCase {
  constructor(private readonly repo: ProductRepository) {}

  async execute(productId: string, input: any) {
    const product = await this.repo.findById(productId);

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    if (input.name) {
      product.rename(input.name);
    }

    if ("description" in input) {
      product.updateDescription(input.description);
    }

    if ("isActive" in input) {
      input.isActive ? product.activate() : product.deactivate();
    }

    if (Array.isArray(input.entitlements)) {
      input.entitlements.forEach((e: string) => product.addEntitlement(e));
    }

    if (Array.isArray(input.usageLimits)) {
      input.usageLimits.forEach((l: any) => product.addUsageLimit(l));
    }

    if (
      product.type === ProductType.SUBSCRIPTION &&
      Array.isArray(input.addons)
    ) {
      input.addons.forEach((addonId: string) => product.addAddon(addonId));
    }

    if (input.providers && typeof input.providers === "object") {
      product.updateProviders(input.providers);
    }

    await this.repo.update(product);

    return {
      updated: true,
      name: product.name,
      productId: product.productId,
    };
  }
}
