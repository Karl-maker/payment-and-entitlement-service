import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAMES } from "./localstack";

/** Fixed product ID used by PUT/DELETE role-based e2e tests. */
export const SEED_PRODUCT_ID = "seed-product-edit-delete";

const SEED_PRODUCT = {
  name: "Seeded Product for Edit/Delete",
  type: "subscription",
  entitlements: ["subject_access", "token"],
  isActive: true,
};

export interface ProductTargetingInput {
  countries?: string[];
  percentage?: number;
  cidrBlocks?: string[];
}

/**
 * Seeds a single product into the products table for PUT and DELETE role-based e2e tests.
 * Uses SEED_PRODUCT_ID so tests can target the same product by id.
 * Call in beforeEach for describe blocks that test PUT /products/:id and DELETE /products/:id.
 */
export async function seedProductForEditDelete(): Promise<{
  productId: string;
  name: string;
  type: string;
  entitlements: string[];
  isActive: boolean;
}> {
  const now = new Date().toISOString();
  const item = {
    PK: `PRODUCT#${SEED_PRODUCT_ID}`,
    SK: "METADATA",
    GSI1PK: `TYPE#${SEED_PRODUCT.type}`,
    GSI1SK: `CREATED#${now}`,
    productId: SEED_PRODUCT_ID,
    name: SEED_PRODUCT.name,
    nameLower: SEED_PRODUCT.name.toLowerCase(),
    description: null,
    type: SEED_PRODUCT.type,
    entitlements: SEED_PRODUCT.entitlements,
    usageLimits: [],
    addons: [],
    addonConfigs: [],
    providers: {},
    isActive: SEED_PRODUCT.isActive,
    createdAt: now,
    updatedAt: now,
  };

  await docClient().send(
    new PutCommand({
      TableName: TABLE_NAMES.products,
      Item: item,
    }),
  );

  return {
    productId: SEED_PRODUCT_ID,
    name: SEED_PRODUCT.name,
    type: SEED_PRODUCT.type,
    entitlements: SEED_PRODUCT.entitlements,
    isActive: SEED_PRODUCT.isActive,
  };
}

export interface SeedProductInput {
  productId: string;
  name: string;
  type?: string;
  entitlements: string[];
  usageLimits?: Array<{ metric: string; limit: number; period: string }>;
  isActive?: boolean;
  targeting?: ProductTargetingInput;
}

/**
 * Seeds a single product with the given attributes. Used for by-entitlement and usage tests.
 */
export async function seedProduct(input: SeedProductInput): Promise<void> {
  const now = new Date().toISOString();
  const type = input.type ?? "subscription";
  const item: Record<string, unknown> = {
    PK: `PRODUCT#${input.productId}`,
    SK: "METADATA",
    GSI1PK: `TYPE#${type}`,
    GSI1SK: `CREATED#${now}`,
    productId: input.productId,
    name: input.name,
    nameLower: input.name.toLowerCase(),
    description: null,
    type,
    entitlements: input.entitlements,
    usageLimits: input.usageLimits ?? [],
    addons: [],
    addonConfigs: [],
    providers: {},
    targeting: input.targeting ?? undefined,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };

  await docClient().send(
    new PutCommand({
      TableName: TABLE_NAMES.products,
      Item: item,
    }),
  );
}

/**
 * Seeds products for GET /products/by-entitlement/{entitlementKey} e2e tests:
 * - One product with entitlement "subject_access" only
 * - One product with entitlements "subject_access" and "token"
 * - Three products with keys "ai_tutor", "ai-tutor", "ai.tutor" (each different)
 */
export async function seedProductsForByEntitlementTests(): Promise<void> {
  await seedProduct({
    productId: "seed-by-ent-one-key",
    name: "Product With One Entitlement",
    entitlements: ["subject_access"],
  });
  await seedProduct({
    productId: "seed-by-ent-two-keys",
    name: "Product With Two Entitlements",
    entitlements: ["subject_access", "token"],
  });
  await seedProduct({
    productId: "seed-ai-underscore",
    name: "Product ai_tutor",
    entitlements: ["ai_tutor"],
  });
  await seedProduct({
    productId: "seed-ai-hyphen",
    name: "Product ai-tutor",
    entitlements: ["ai-tutor"],
  });
  await seedProduct({
    productId: "seed-ai-dot",
    name: "Product ai.tutor",
    entitlements: ["ai.tutor"],
  });
}

/**
 * Seeds many products for GET /products query params and pagination e2e tests.
 * Variety: type (subscription, one_off, addon), isActive (true/false), entitlements (subject_access, token, both).
 * Total 15 products so pagination (e.g. page_size=3, page_number=1,2,3...) can be tested.
 */
export async function seedProductsForListAndPaginationTests(): Promise<void> {
  const base = [
    {
      productId: "list-sub-1",
      name: "Sub Active 1",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-sub-2",
      name: "Sub Active 2",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["token"],
    },
    {
      productId: "list-sub-3",
      name: "Sub Active 3",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["subject_access", "token"],
    },
    {
      productId: "list-sub-4",
      name: "Sub Active 4",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-sub-5",
      name: "Sub Active 5",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["token"],
    },
    {
      productId: "list-sub-6",
      name: "Sub Inactive",
      type: "subscription" as const,
      isActive: false,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-one-1",
      name: "One-off Active 1",
      type: "one_off" as const,
      isActive: true,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-one-2",
      name: "One-off Active 2",
      type: "one_off" as const,
      isActive: true,
      entitlements: ["token"],
    },
    {
      productId: "list-one-3",
      name: "One-off Inactive",
      type: "one_off" as const,
      isActive: false,
      entitlements: ["subject_access", "token"],
    },
    {
      productId: "list-addon-1",
      name: "Addon Active",
      type: "addon" as const,
      isActive: true,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-addon-2",
      name: "Addon Inactive",
      type: "addon" as const,
      isActive: false,
      entitlements: ["token"],
    },
    {
      productId: "list-sub-7",
      name: "Sub Extra 1",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["subject_access"],
    },
    {
      productId: "list-sub-8",
      name: "Sub Extra 2",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["token"],
    },
    {
      productId: "list-sub-9",
      name: "Sub Extra 3",
      type: "subscription" as const,
      isActive: true,
      entitlements: ["subject_access", "token"],
    },
    {
      productId: "list-sub-10",
      name: "Sub Inactive 2",
      type: "subscription" as const,
      isActive: false,
      entitlements: ["token"],
    },
  ];
  for (const p of base) {
    await seedProduct({
      productId: p.productId,
      name: p.name,
      type: p.type,
      entitlements: p.entitlements,
      isActive: p.isActive,
    });
  }
}
