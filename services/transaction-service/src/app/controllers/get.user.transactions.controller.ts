import { RequestContext } from "../../handler/api-gateway/types";
import { GetUserTransactionsUseCase } from "../usecases/get.user.transactions.usecase";

export class GetUserTransactionsController {
  constructor(
    private readonly useCase: GetUserTransactionsUseCase
  ) {}

  handle = async (req: RequestContext) => {
    const requestingUserId = req.user?.id;
    const userRole = req.user?.role;
    const isAdmin = userRole === "ADMIN";

    if (!requestingUserId) {
      throw new Error("User ID is required");
    }

    // Default to authenticated user's ID, but allow admins to filter by userId
    let userId = requestingUserId;
    if (isAdmin && req.query.userId) {
      userId = req.query.userId;
    } else if (!isAdmin && req.query.userId && req.query.userId !== requestingUserId) {
      // Non-admin users cannot filter by different userId
      throw new Error("Unauthorized: You can only view your own transactions");
    }

    const limit = req.query.limit ? parsePositiveInteger(req.query.limit, "limit") : undefined;
    const provider = parseProvider(req.query.provider);
    const cursor = req.query.cursor?.trim() || undefined;

    const result = await this.useCase.execute({ userId, limit, provider, cursor });

    return {
      userId,
      transactions: result.items.map(t => ({
        transactionId: t.transactionId,
        type: t.type,
        status: t.status,
        amount: t.amount,
        currency: t.currency,
        productId: t.productId,
        priceId: t.priceId,
        subscriptionId: t.subscriptionId,
        provider: t.provider,
        createdAt: t.createdAt.toISOString(),
        metadata: t.metadata,
      })),
      count: result.items.length,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  };
}

function parsePositiveInteger(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.name = "ValidationError";
    throw error;
  }

  return parsed;
}

function parseProvider(value?: string): "stripe" | "powertranz" | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "stripe" || normalized === "powertranz") {
    return normalized;
  }

  const error = new Error("provider must be one of: stripe, powertranz");
  error.name = "ValidationError";
  throw error;
}
