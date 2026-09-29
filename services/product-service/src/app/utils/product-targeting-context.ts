import { RequestContext } from "../../handler/api-gateway/types";

export interface ProductTargetingContext {
  userId?: string;
  country?: string;
  ipAddress?: string;
}

export function buildProductRequestContext(
  req: RequestContext & { user?: { id?: string } },
): ProductTargetingContext {
  const headers = req.headers ?? {};
  const userId = req.user?.id?.trim() || undefined;

  const countryHeader =
    headers["cloudfront-viewer-country"] ||
    headers["cloudfront-viewer-country-name"];

  const country = countryHeader?.trim().toUpperCase() || undefined;

  const forwardedFor = headers["x-forwarded-for"];
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() || req.sourceIp?.trim() || undefined;

  return {
    userId,
    country,
    ipAddress,
  };
}
