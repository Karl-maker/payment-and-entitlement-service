import {
  DeleteProductUseCase,
  ForbiddenError,
  AuthenticationError,
} from "@libs/domain";
import { RequestContext } from "../../handler/api-gateway/types";

function isAdminRole(role?: string): boolean {
  const r = role?.toLowerCase().trim();
  return r === "admin" || r === "administrator";
}
export class DeleteProductController {
  constructor(private readonly useCase: DeleteProductUseCase) {}

  handle = async (
    req: RequestContext & { user?: { id: string; role: string } },
  ) => {
    if (!req.user?.id) {
      throw new AuthenticationError("User not authenticated");
    }

    if (!isAdminRole(req.user.role)) {
      throw new ForbiddenError("Access denied");
    }

    const productId = req.pathParams.id;
    return this.useCase.execute(productId);
  };
}
