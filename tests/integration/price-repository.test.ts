import {
  createAllTables,
  deleteAllTables,
  clearTable,
  setTestEnvVars,
  TABLE_NAMES,
} from "../helpers/localstack";
import { DynamoPriceRepository } from "@libs/domain";
import { seedPricesForListByProductTests } from "../helpers/pricing-service-seed";

describe("DynamoPriceRepository Integration Tests", () => {
  let priceRepository: DynamoPriceRepository;

  beforeAll(async () => {
    priceRepository = new DynamoPriceRepository();
    setTestEnvVars();
    await createAllTables();
  });

  afterAll(async () => {
    await deleteAllTables();
  });

  beforeEach(async () => {
    await clearTable(TABLE_NAMES.products);
    await clearTable(TABLE_NAMES.prices);
  });

  it("should only return the prices for the requested product", async () => {
    const seededPrices = await seedPricesForListByProductTests();

    const result = await priceRepository.findByProductId(
      seededPrices.targetProductId,
      {
        pageNumber: 1,
        pageSize: 10,
      },
    );

    expect(result.items.length).toBe(seededPrices.targetPriceIds.length);
    const ids = result.items.map((p) => p.priceId);
    seededPrices.targetPriceIds.forEach((id) => expect(ids).toContain(id));
    seededPrices.otherPriceIds.forEach((id) => expect(ids).not.toContain(id));
  });

  it("paginates prices correctly", async () => {
    const seededPrices = await seedPricesForListByProductTests();

    const page1 = await priceRepository.findByProductId(
      seededPrices.targetProductId,
      {
        pageNumber: 1,
        pageSize: 2,
      },
    );

    const page2 = await priceRepository.findByProductId(
      seededPrices.targetProductId,
      {
        pageNumber: 2,
        pageSize: 2,
      },
    );

    expect(page1.items.length).toBeLessThanOrEqual(2);
    expect(page2.items.length).toBeLessThanOrEqual(2);

    const ids1 = page1.items.map((p) => p.priceId);
    const ids2 = page2.items.map((p) => p.priceId);
    ids1.forEach((id) => expect(ids2).not.toContain(id));
  });
});
