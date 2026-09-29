import { RequestContext } from "../../handler/api-gateway/types";
import {
  UpdatePriceUseCase,
  AuthenticationError,
  ForbiddenError,
} from "@libs/domain";

function isAdminRole(role?: string): boolean {
  const r = role?.toLowerCase().trim();
  return r === "admin" || r === "administrator";
}

export class UpdatePriceController {
  constructor(private readonly useCase: UpdatePriceUseCase) {}

  handle = async (req: RequestContext) => {
    if (!req.user?.id) {
      throw new AuthenticationError("Authorization required");
    }

    if (!isAdminRole(req.user.role)) {
      throw new ForbiddenError("Admin role required to update prices");
    }
    const priceId = req.pathParams.id;
    return this.useCase.execute(priceId, req.body);
  };
}
