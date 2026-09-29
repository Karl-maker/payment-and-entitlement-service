import { AuthenticationError } from "@libs/domain";
import { RequestContext } from "../../handler/api-gateway/types";
import {
  PowerTranzIntentStatus,
} from "../../infrastructure/powertranz.intent.repository";
import { GetPowerTranzInvoicesUseCase } from "../usecases/get.powertranz.invoices.usecase";

const ALLOWED_STATUSES: ReadonlySet<PowerTranzIntentStatus> = new Set([
  "pending_payment",
  "completed",
  "failed",
  "expired",
]);

export class GetPowerTranzInvoicesController {
  constructor(
    private readonly useCase: GetPowerTranzInvoicesUseCase,
  ) {}

  handle = async (
    req: RequestContext & {
      user?: { id: string; role?: string };
    },
  ) => {
    const requestingUserId = req.user?.id;
    const userRole = req.user?.role;
    const isAdmin = userRole === "ADMIN";

    if (!requestingUserId) {
      throw new AuthenticationError("Authorization required");
    }

    let userId = requestingUserId;
    if (isAdmin && req.query.userId) {
      userId = req.query.userId;
    } else if (
      !isAdmin &&
      req.query.userId &&
      req.query.userId !== requestingUserId
    ) {
      throw new AuthenticationError(
        "Unauthorized: You can only view your own invoices",
      );
    }

    const statusQuery = req.query.status as PowerTranzIntentStatus | undefined;
    const status =
      statusQuery && ALLOWED_STATUSES.has(statusQuery) ? statusQuery : undefined;

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const invoices = await this.useCase.execute({
      userId,
      limit,
      status,
      spiToken: req.query.spiToken,
      transactionIdentifier: req.query.transactionIdentifier,
      orderIdentifier: req.query.orderIdentifier,
    });

    return {
      userId,
      invoices: invoices.map((invoice) => ({
        invoiceId: invoice.id,
        provider: "powertranz",
        spiToken: invoice.spiToken,
        transactionIdentifier: invoice.transactionId,
        orderIdentifier: invoice.orderIdentifier,
        amount: invoice.amount,
        currency: invoice.currency,
        priceId: invoice.priceId,
        productId: invoice.productId,
        status: invoice.status,
        createdAt: invoice.createdAt,
        expiresAt: invoice.expiresAt,
        paidAt: invoice.paidAt ?? null,
        paymentTime: invoice.paidAt ?? null,
        failedAt: invoice.failedAt ?? null,
        lastCallbackAt: invoice.lastCallbackAt ?? null,
        approved: invoice.approved ?? null,
        isoResponseCode: invoice.isoResponseCode ?? null,
        responseMessage: invoice.responseMessage ?? null,
        cardBrand: invoice.cardBrand ?? null,
        transactionType: invoice.transactionType ?? null,
        lastErrorCode: invoice.lastErrorCode ?? null,
        lastErrorMessage: invoice.lastErrorMessage ?? null,
      })),
      count: invoices.length,
    };
  };
}
