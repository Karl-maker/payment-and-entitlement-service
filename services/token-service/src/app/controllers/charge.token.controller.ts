import { ChargeTokenUseCase } from "../usecases/charge.token.usecase";
import { AuthenticationError } from "@libs/domain";
import { RequestContext } from "../../handler/api-gateway/types";

export class ChargeTokenController {
  constructor(private readonly useCase: ChargeTokenUseCase) {}

  handle = async (
    req: RequestContext & { user?: { id: string; role?: string } },
  ) => {
    const { priceId } = req.body ?? {};

    if (!req.user?.id) {
      throw new AuthenticationError("Authorization required");
    }

    const userId = req.user.id;
    const idempotencyKey =
      req.headers?.["idempotency-key"] ?? req.headers?.["Idempotency-Key"];

    if (!priceId) {
      throw new Error("priceId is required");
    }

    return await this.useCase.execute({
      userId,
      priceId,
      idempotencyKey,
    });
  };
}
