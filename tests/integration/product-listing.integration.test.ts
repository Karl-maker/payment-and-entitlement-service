import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";

import { DynamoProductRepository, ListProductsUseCase } from "@libs/domain";
import {
  seedProductsForListAndPaginationTests,
  seedProductsForByEntitlementTests,
  seedProduct,
} from "../helpers/product-service-seed";
import {
  findUserIdForBucketBelow,
  findUserIdForBucketAtOrAbove,
} from "../helpers/product-targeting-test-helper";
import { ProductType } from "../../libs/domain/src/products/domain/value-objects/product-type.vo";

describe("Product listing integration tests", () => {
  let repo: DynamoProductRepository;
  let useCase: ListProductsUseCase;

  beforeAll(async () => {
    setTestEnvVars();
    await createAllTables();
    repo = new DynamoProductRepository();
    useCase = new ListProductsUseCase(repo);
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  it("returns all inactive products when isActive=false", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      isActive: false,
    });

    expect(result.items.length).toBe(4);
    result.items.forEach((product) => {
      expect(product.isActive).toBe(false);
    });
  });

  it("searches all product types when entitlementKey is provided without type", async () => {
    await seedProductsForByEntitlementTests();

    const result = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      entitlementKey: "subject_access",
    });

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    result.items.forEach((product) => {
      expect(product.entitlements).toContain("subject_access");
    });
  });

  it("preserves type filtering when type is provided", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      type: ProductType.ADDON,
      isActive: true,
    });

    expect(result.items.length).toBeGreaterThan(0);
    result.items.forEach((product) => {
      expect(product.type).toBe("addon");
      expect(product.isActive).toBe(true);
    });
  });

  it("paginates correctly on filtered data", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await useCase.execute({
      pageNumber: 2,
      pageSize: 3,
      isActive: true,
    });

    expect(result.items.length).toBeLessThanOrEqual(3);
    expect(result.pageNumber).toBe(2);
    expect(result.pageSize).toBe(3);
  });

  it("filters products by country", async () => {
    await seedProduct({
      productId: "country-us",
      name: "US Only Product",
      entitlements: ["subject_access"],
      targeting: {
        countries: ["US"],
      },
    });

    await seedProduct({
      productId: "country-ca",
      name: "CA Only Product",
      entitlements: ["subject_access"],
      targeting: {
        countries: ["CA"],
      },
    });

    const usResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      country: "US",
    });

    expect(usResult.items).toHaveLength(1);
    expect(usResult.items[0].productId).toBe("country-us");

    const caResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      country: "CA",
    });

    expect(caResult.items).toHaveLength(1);
    expect(caResult.items[0].productId).toBe("country-ca");
  });

  it("filters products by user percentage bucket", async () => {
    const entitlementKey = "subject_access";

    await seedProduct({
      productId: "percent-20",
      name: "Twenty Percent Product",
      entitlements: ["subject_access"],
      targeting: {
        percentage: 20,
      },
    });

    const matchingUserId = findUserIdForBucketBelow(20, entitlementKey);
    const nonMatchingUserId = findUserIdForBucketAtOrAbove(20, entitlementKey);

    const matchingResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      type: ProductType.SUBSCRIPTION,
      entitlementKey,
      userId: matchingUserId,
    });

    expect(matchingResult.items.map((p) => p.productId)).toContain(
      "percent-20",
    );

    const nonMatchingResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      type: ProductType.SUBSCRIPTION,
      entitlementKey,
      userId: nonMatchingUserId,
    });

    expect(nonMatchingResult.items).toHaveLength(0);
  });

  it("filters products by IP CIDR block", async () => {
    await seedProduct({
      productId: "cidr-allowed",
      name: "CIDR Allowed Product",
      entitlements: ["subject_access"],
      targeting: {
        cidrBlocks: ["203.0.113.0/24"],
      },
    });

    const allowedResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      ipAddress: "203.0.113.10",
    });

    expect(allowedResult.items).toHaveLength(1);
    expect(allowedResult.items[0].productId).toBe("cidr-allowed");

    const deniedResult = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      ipAddress: "198.51.100.10",
    });

    expect(deniedResult.items).toHaveLength(0);
  });

  it("requires all targeting rules to pass", async () => {
    await seedProduct({
      productId: "and-targeted",
      name: "Country And CIDR Product",
      entitlements: ["subject_access"],
      targeting: {
        countries: ["US"],
        cidrBlocks: ["203.0.113.0/24"],
      },
    });

    const fullMatch = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      country: "US",
      ipAddress: "203.0.113.10",
    });

    expect(fullMatch.items).toHaveLength(1);
    expect(fullMatch.items[0].productId).toBe("and-targeted");

    const missingCountry = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      ipAddress: "203.0.113.10",
    });

    expect(missingCountry.items).toHaveLength(0);

    const missingIp = await useCase.execute({
      pageNumber: 1,
      pageSize: 20,
      country: "US",
    });

    expect(missingIp.items).toHaveLength(0);
  });
});
