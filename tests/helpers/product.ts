import {
  EntitlementKey,
  Product,
  ProductType,
  type ProductRepositoryPorts,
} from "@libs/domain";

type CreateProductInput = {
  productId: string;
  name?: string;
  description?: string;
  type?: ProductType;
  entitlements?: EntitlementKey[];
  isActive?: boolean;
  addons?: string[];
  addonConfigs?: any[];
  providers?: Record<string, string>;
  usageLimits?: any[];
};

export async function createProduct(
  productRepo: ProductRepositoryPorts.ProductRepository,
  createdProductIds: string[],
  input: CreateProductInput,
) {
  const product = Product.create({
    productId: input.productId,
    name: input.name ?? `Integration Product ${input.productId}`,
    description: input.description,
    type: input.type ?? ProductType.SUBSCRIPTION,
    entitlements: input.entitlements ?? [EntitlementKey.SUBJECT_ACCESS],
    isActive: input.isActive ?? true,
    addons: input.addons ?? [],
    addonConfigs: input.addonConfigs ?? [],
    providers: input.providers ?? {},
    usageLimits: input.usageLimits ?? [],
  });

  await productRepo.create(product);
  createdProductIds.push(input.productId);

  return product;
}
