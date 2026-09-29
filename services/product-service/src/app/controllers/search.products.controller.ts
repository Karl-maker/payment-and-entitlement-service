import { RequestContext } from "../../handler/api-gateway/types";
import { SearchProductsUseCase, ProductResponseMapper } from "@libs/domain";
import { buildProductRequestContext } from "../utils/product-targeting-context";

export class SearchProductsController {
  constructor(private readonly useCase: SearchProductsUseCase) {}

  handle = async (req: RequestContext) => {
    const pageNumber = Number(req.query.page_number ?? 1);
    const pageSize = Number(req.query.page_size ?? 20);
    const targetingContext = buildProductRequestContext(req);

    const result = await this.useCase.execute({
      pageNumber,
      pageSize,
      namePrefix: req.query.name_prefix as string | undefined,
      type: req.query.type as any,
      isActive: req.query.active ? req.query.active === "true" : undefined,
      userId: targetingContext.userId,
      country: targetingContext.country,
      ipAddress: targetingContext.ipAddress,
    });

    // Transform to new response format
    const total = result.total >= 0 ? result.total : 0;
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

    return {
      amount: total,
      data: ProductResponseMapper.toDtoList(result.items),
      pagination: {
        page_size: pageSize,
        page_number: pageNumber,
        total_pages: totalPages,
      },
    };
  };
}
