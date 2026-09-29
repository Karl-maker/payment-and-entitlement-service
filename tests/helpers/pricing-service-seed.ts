import { seedProduct } from "./product-service-seed";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAMES } from "./localstack";

/** Product ID seeded for pricing POST e2e tests (must exist before creating a price). */
export const PRICING_SEED_PRODUCT_ID = "pricing-seed-product-1";

/**
 * Seeds a product that exists in the products table so POST /prices can reference a valid productId.
 */
export async function seedProductForPricingPostTests(): Promise<void> {
  await seedProduct({
    productId: PRICING_SEED_PRODUCT_ID,
    name: "Seeded Product for Pricing Tests",
    type: "subscription",
    entitlements: ["subject_access"],
    isActive: true,
  });
}


export const PRICING_LIST_TARGET_PRODUCT_ID = "pricing-list-product-target";
export const PRICING_LIST_OTHER_PRODUCT_ID = "pricing-list-product-other";

/**
 * Seeds products and many prices for GET /prices/product/{productId} tests.
 * - target product: 4 prices
 * - other product: 3 prices
 */
export async function seedPricesForListByProductTests(): Promise<{
  targetProductId: string;
  otherProductId: string;
  targetPriceIds: string[];
  otherPriceIds: string[];
}> {
  await seedProduct({
    productId: PRICING_LIST_TARGET_PRODUCT_ID,
    name: "Pricing List Target Product",
    type: "subscription",
    entitlements: ["subject_access"],
    isActive: true,
  });
  await seedProduct({
    productId: PRICING_LIST_OTHER_PRODUCT_ID,
    name: "Pricing List Other Product",
    type: "subscription",
    entitlements: ["token"],
    isActive: true,
  });

  const targetPriceIds = ["price-target-1", "price-target-2", "price-target-3", "price-target-4"];
  const otherPriceIds = ["price-other-1", "price-other-2", "price-other-3"];

  const putPrice = async (priceId: string, productId: string, amount: number, currency: string) => {
    const now = new Date().toISOString();
    await docClient().send(
      new PutCommand({
        TableName: TABLE_NAMES.prices,
        Item: {
          PK: `PRICE#${priceId}`,
          SK: "METADATA",
          GSI1PK: `PRODUCT#${productId}`,
          GSI1SK: `CREATED#${now}`,
          priceId,
          productId,
          billingType: "one_time",
          interval: undefined,
          frequency: 1,
          amount,
          currency,
          providers: {},
          createdAt: now,
          updatedAt: now,
        },
      })
    );
  };

  await putPrice(targetPriceIds[0], PRICING_LIST_TARGET_PRODUCT_ID, 999, "USD");
  await putPrice(targetPriceIds[1], PRICING_LIST_TARGET_PRODUCT_ID, 1999, "EUR");
  await putPrice(targetPriceIds[2], PRICING_LIST_TARGET_PRODUCT_ID, 2999, "GBP");
  await putPrice(targetPriceIds[3], PRICING_LIST_TARGET_PRODUCT_ID, 3999, "TOKEN");

  await putPrice(otherPriceIds[0], PRICING_LIST_OTHER_PRODUCT_ID, 111, "USD");
  await putPrice(otherPriceIds[1], PRICING_LIST_OTHER_PRODUCT_ID, 222, "EUR");
  await putPrice(otherPriceIds[2], PRICING_LIST_OTHER_PRODUCT_ID, 333, "TOKEN");

  return {
    targetProductId: PRICING_LIST_TARGET_PRODUCT_ID,
    otherProductId: PRICING_LIST_OTHER_PRODUCT_ID,
    targetPriceIds,
    otherPriceIds,
  };
}
