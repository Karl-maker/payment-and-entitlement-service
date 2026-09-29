/**
 * ISO 4217 alphabetic codes in common use, plus TOKEN for native-token pricing.
 */
const ALLOWED_PRICE_CURRENCIES = new Set<string>([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "INR",
  "MXN",
  "BRL",
  "KRW",
  "SGD",
  "HKD",
  "NOK",
  "SEK",
  "NZD",
  "ZAR",
  "TRY",
  "PLN",
  "THB",
  "IDR",
  "MYR",
  "PHP",
  "CZK",
  "HUF",
  "ILS",
  "CLP",
  "PKR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "JMD",
  "TTD",
  "BBD",
  "XCD",
  "TOKEN",
]);

export function isAllowedPriceCurrency(code: string): boolean {
  const normalized = code?.trim().toUpperCase() ?? "";
  return ALLOWED_PRICE_CURRENCIES.has(normalized);
}
