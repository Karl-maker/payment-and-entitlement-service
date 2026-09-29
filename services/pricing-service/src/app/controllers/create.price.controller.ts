import { RequestContext } from "../../handler/api-gateway/types";
import {
  CreatePriceUseCase,
  AuthenticationError,
  ForbiddenError,
} from "@libs/domain";

function isAdminRole(role?: string): boolean {
  const r = role?.toLowerCase().trim();
  return r === "admin" || r === "administrator";
}

export class CreatePriceController {
  constructor(private readonly useCase: CreatePriceUseCase) {}

  handle = async (
    req: RequestContext & { user?: { id: string; role?: string } }
  ) => {
    if (!req.user?.id) {
      throw new AuthenticationError("Authorization required");
    }
    if (!isAdminRole(req.user.role)) {
      throw new ForbiddenError("Admin role required to create prices");
    }
    return this.useCase.execute(req.body);
  };
}
