import { jest } from "@jest/globals";
import {
  CreateProductUseCase,
  ProductType,
  ProductRepositoryPorts,
} from "@libs/domain";

function makeRepo() {
  return {
    create: jest.fn(async () => undefined),
  } as unknown as ProductRepositoryPorts.ProductRepository;
}

describe("CreateProductUseCase", () => {
  it("creates an inactive product when isActive=false", async () => {
    const repo = makeRepo();
    const useCase = new CreateProductUseCase(repo);

    await useCase.execute({
      name: "Inactive Product",
      description: "Should be stored as inactive",
      type: ProductType.SUBSCRIPTION,
      entitlements: ["subject_access"],
      isActive: false,
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    const createdProduct = (repo.create as jest.Mock).mock.calls[0][0] as any;
    expect(createdProduct.isActive).toBe(false);
  });

  it("creates an inactive product when deactivated=true", async () => {
    const repo = makeRepo();
    const useCase = new CreateProductUseCase(repo);

    await useCase.execute({
      name: "Deactivated Product",
      description: "Should respect deactivated input",
      type: ProductType.SUBSCRIPTION,
      entitlements: ["subject_access"],
      deactivated: true,
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    const createdProduct = (repo.create as jest.Mock).mock.calls[0][0] as any;
    expect(createdProduct.isActive).toBe(false);
  });
});
