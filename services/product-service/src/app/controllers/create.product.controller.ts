import { RequestContext } from "../../handler/api-gateway/types";
import {
  CreateProductUseCase,
  ForbiddenError,
  AuthenticationError,
} from "@libs/domain";

function isAdminRole(role?: string): boolean {
  const r = role?.toLowerCase().trim();
  return r === "admin" || r === "administrator";
}

export class CreateProductController {
  constructor(private readonly useCase: CreateProductUseCase) {}

  handle = async (
    req: RequestContext & { user?: { id: string; role: string } },
  ) => {
    if (!req.user?.id) {
      throw new AuthenticationError("User not authenticated");
    }

    if (!isAdminRole(req.user.role)) {
      throw new ForbiddenError("Access denied");
    }

    return this.useCase.execute(req.body);
  };
}
