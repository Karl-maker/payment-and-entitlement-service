import { AuthenticationError } from "@libs/domain";
import { RequestContext } from "../../handler/api-gateway/types";
import { BadRequestError } from "../errors/bad-request.error";
import {
  CreatePaymentIntentUseCase,
  PowerTranzCardType,
} from "../usecases/create.payment.intent.usecase";
export class CreatePaymentIntentController {
  // for creating a payment intent, ensuring thete is jwt and price_id and then sends it to the usecase
  constructor(private readonly useCase: CreatePaymentIntentUseCase) {}

  handle = async (
    req: RequestContext & {
      user?: { id: string; role?: string; email?: string };
    },
  ) => {
    if (!req.user?.id) {
      throw new AuthenticationError("Authorization required");
    }

    const priceId = req.body?.price_id;
    const cardTypeRaw = req.body?.card_type;
    if (!priceId) {
      throw new BadRequestError("price_id is required");
    }

    let cardType: PowerTranzCardType | undefined;
    if (cardTypeRaw !== undefined && cardTypeRaw !== null && cardTypeRaw !== "") {
      const normalized = String(cardTypeRaw).trim().toLowerCase();
      if (normalized !== "debit" && normalized !== "credit") {
        throw new BadRequestError("card_type must be either 'debit' or 'credit'");
      }
      cardType = normalized;
    }

    return this.useCase.execute({
      userId: req.user.id,
      userEmail: req.user.email,
      priceId,
      cardType,
    });
  };
}
