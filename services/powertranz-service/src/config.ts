export interface PowerTranzConfig {
  baseUrl: string;
  merchantId: string;
  merchantPassword: string;
  callbackSecret: string;
  merchantResponseUrl: string;
  billingRedirectBaseUrl: string;
  threeDsEnabled: boolean;
  allowNonThreeDsFallback: boolean;
  hostedPagePageSet: string;
  hostedPagePageName: string;
  usdTtdExchangeRate: number;
}

export interface PowerTranzServiceConfig {
  powertranz: PowerTranzConfig;
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
}

const config: PowerTranzServiceConfig = {
  powertranz: {
    baseUrl: process.env.POWERTRANZ_BASE_URL || "",
    merchantId: process.env.POWERTRANZ_MERCHANT_ID || "",
    merchantPassword: process.env.POWERTRANZ_MERCHANT_PASSWORD || "",
    callbackSecret: process.env.POWERTRANZ_CALLBACK_SECRET || "",
    merchantResponseUrl: process.env.POWERTRANZ_MERCHANT_RESPONSE_URL || "",
    billingRedirectBaseUrl:
      process.env.POWERTRANZ_BILLING_REDIRECT_BASE_URL ||
      "https://development.is-ed.com",
    threeDsEnabled: envFlag(process.env.POWERTRANZ_3DS_ENABLED, true),
    allowNonThreeDsFallback: envFlag(
      process.env.POWERTRANZ_ALLOW_NON_3DS_FALLBACK,
      true,
    ),
    hostedPagePageSet: process.env.POWERTRANZ_HPP_PAGE_SET || "Payment",
    hostedPagePageName: process.env.POWERTRANZ_HPP_PAGE_NAME || "Eislett",
    usdTtdExchangeRate: Number(process.env.USD_TTD_EXCHANGE_RATE || "6.8"),
  },
};

export default config;
