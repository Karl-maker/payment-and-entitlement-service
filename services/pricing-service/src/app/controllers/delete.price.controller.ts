import { RequestContext } from "../../handler/api-gateway/types";
import {
  DeletePriceUseCase,
  AuthenticationError,
  ForbiddenError,
} from "@libs/domain";

function isAdminRole(role?: string): boolean {
  const r = role?.toLowerCase().trim();
  return r === "admin" || r === "administrator";
}
export class DeletePriceController {
  constructor(private readonly useCase: DeletePriceUseCase) {}

  handle = async (req: RequestContext) => {
    if (!req.user?.id) {
      throw new AuthenticationError("Authorization required");
    }

    if (!isAdminRole(req.user.role)) {
      throw new ForbiddenError("Admin role required to delete prices");
    }

    const priceId = req.pathParams.id;
    return this.useCase.execute(priceId);
  };
}
