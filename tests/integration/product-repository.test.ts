import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { DynamoProductRepository, ProductType } from "@libs/domain";
import {
  seedProductsForListAndPaginationTests,
  seedProductsForByEntitlementTests,
} from "../helpers/product-service-seed";

describe("DynamoProductRepository Integration Tests", () => {
  let repo: DynamoProductRepository;

  beforeAll(async () => {
    setTestEnvVars();
    await createAllTables();
    repo = new DynamoProductRepository();
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
  });

  it("returns inactive products when isActive=false", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await repo.list(
      { isActive: false },
      { pageNumber: 1, pageSize: 50 },
    );

    expect(result.items.length).toBe(2);
    result.items.forEach((product) => {
      expect(product.isActive).toBe(false);
    });
  });

  it("returns active products when isActive=true", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await repo.list(
      { isActive: true },
      { pageNumber: 1, pageSize: 50 },
    );

    expect(result.items.length).toBe(8); // default is subscription product
    result.items.forEach((product) => {
      expect(product.isActive).toBe(true);
    });
  });

  it("filters by entitlementKey across all types", async () => {
    await seedProductsForByEntitlementTests();

    const result = await repo.list(
      { entitlementKey: "subject_access" },
      { pageNumber: 1, pageSize: 50 },
    );

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    result.items.forEach((product) => {
      expect(product.entitlements).toContain("subject_access");
    });
  });

  it("paginates after filtering", async () => {
    await seedProductsForListAndPaginationTests();

    const page1 = await repo.list(
      { isActive: true },
      { pageNumber: 1, pageSize: 3 },
    );
    const page2 = await repo.list(
      { isActive: true },
      { pageNumber: 2, pageSize: 3 },
    );

    expect(page1.items.length).toBeLessThanOrEqual(3);
    expect(page2.items.length).toBeLessThanOrEqual(3);

    const ids1 = page1.items.map((p) => p.productId);
    const ids2 = page2.items.map((p) => p.productId);
    ids1.forEach((id) => expect(ids2).not.toContain(id));
  });

  it("respects type when type filter is provided", async () => {
    await seedProductsForListAndPaginationTests();

    const result = await repo.list(
      { type: ProductType.ONE_OFF, isActive: true },
      { pageNumber: 1, pageSize: 50 },
    );

    expect(result.items.length).toBeGreaterThan(0);
    result.items.forEach((product) => {
      expect(product.type).toBe("one_off");
      expect(product.isActive).toBe(true);
    });
  });
});
