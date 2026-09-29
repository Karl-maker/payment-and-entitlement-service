import { seedProduct } from "./product-service-seed";

export const TARGET_ENTITLEMENT_KEY = "subject_access";
export const ROLLOUT_PERCENTAGE = 20;

export const TARGET_PRODUCT_IDS = {
  countryUs: "country-us-product",
  countryCa: "country-ca-product",
  percent20: "percent-20-product",
  cidrAllowed: "cidr-allowed-product",
  cidrDenied: "cidr-denied-product",
  andTargeted: "and-targeted-product",
  byEntCountryUs: "by-ent-country-us",
  byEntCountryCa: "by-ent-country-ca",
  byEntCidrAllowed: "by-ent-cidr-allowed",
  byEntCidrDenied: "by-ent-cidr-denied",
  byEntPercent20: "by-ent-percent-20",
} as const;

export async function seedCountryTargetedProducts(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.countryUs,
    name: "US Only Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      countries: ["US"],
    },
  });

  await seedProduct({
    productId: TARGET_PRODUCT_IDS.countryCa,
    name: "CA Only Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      countries: ["CA"],
    },
  });
}

export async function seedPercentageTargetedProduct(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.percent20,
    name: "Twenty Percent Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      percentage: ROLLOUT_PERCENTAGE,
    },
  });
}

export async function seedCidrTargetedProducts(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.cidrAllowed,
    name: "CIDR Allowed Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      cidrBlocks: ["203.0.113.0/24"],
    },
  });

  await seedProduct({
    productId: TARGET_PRODUCT_IDS.cidrDenied,
    name: "CIDR Denied Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      cidrBlocks: ["198.51.100.0/24"],
    },
  });
}

export async function seedByEntitlementCountryTargetedProducts(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.byEntCountryUs,
    name: "By Entitlement US Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      countries: ["US"],
    },
  });

  await seedProduct({
    productId: TARGET_PRODUCT_IDS.byEntCountryCa,
    name: "By Entitlement CA Product",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      countries: ["CA"],
    },
  });
}

export async function seedByEntitlementCidrTargetedProducts(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.byEntCidrAllowed,
    name: "By Entitlement CIDR Allowed",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      cidrBlocks: ["203.0.113.0/24"],
    },
  });

  await seedProduct({
    productId: TARGET_PRODUCT_IDS.byEntCidrDenied,
    name: "By Entitlement CIDR Denied",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      cidrBlocks: ["198.51.100.0/24"],
    },
  });
}

export async function seedByEntitlementPercentageTargetedProduct(): Promise<void> {
  await seedProduct({
    productId: TARGET_PRODUCT_IDS.byEntPercent20,
    name: "By Entitlement Twenty Percent",
    entitlements: [TARGET_ENTITLEMENT_KEY],
    targeting: {
      percentage: ROLLOUT_PERCENTAGE,
    },
  });
}
