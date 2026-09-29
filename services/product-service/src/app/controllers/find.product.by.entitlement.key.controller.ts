import { RequestContext } from "../../handler/api-gateway/types";
import { FindProductByEntitlementKeyUseCase } from "@libs/domain";
import { buildProductRequestContext } from "../utils/product-targeting-context";

export class FindProductByEntitlementKeyController {
  constructor(private readonly useCase: FindProductByEntitlementKeyUseCase) {}

  handle = async (req: RequestContext) => {
    // Path params may be from API Gateway (e.g. entitlementKey) or we extract from path (e.g. /v1/products/by-entitlement/ai_tutor_access)
    let entitlementKey = req.pathParams?.entitlementKey;
    if (!entitlementKey && typeof req.path === "string") {
      const segments = req.path.split("/").filter(Boolean);
      if (
        segments[segments.length - 2] === "by-entitlement" &&
        segments.length >= 3
      ) {
        entitlementKey = segments[segments.length - 1];
      }
    }
    if (!entitlementKey) {
      throw new Error("entitlementKey is required");
    }
    // Allow kebab-case in URL: ai-tutor-access -> ai_tutor_access
    // entitlementKey = entitlementKey.replace(/-/g, "_");
    entitlementKey = entitlementKey.trim().toLowerCase(); // lowercase and trim to ensure consistent matching

    const targetingContext = buildProductRequestContext(req);

    const products = await this.useCase.execute(
      entitlementKey,
      targetingContext,
    );

    return {
      amount: products.length,
      data: products,
    };
  };
}
