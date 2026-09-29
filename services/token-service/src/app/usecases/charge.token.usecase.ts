import {
  EntitlementRepository,
  PriceRepository,
  ProductRepositoryPorts,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  EntitlementKey,
  EntitlementStatus,
  DomainError,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { ProcessedTokenChargesRepository } from "../../infrastructure/processed-token-charges.repository";

class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface ChargeTokenInput {
  userId: string;
  priceId: string;
  idempotencyKey?: string;
}

export interface ChargeTokenOutput {
  success: boolean;
  paymentIntentId: string;
  amount: number;
  remainingTokens: number;
}

const ROLE_LEARNER = "learner" as const;

export class ChargeTokenUseCase {
  constructor(
    private readonly entitlementRepo: EntitlementRepository,
    private readonly priceRepo: PriceRepository,
    private readonly productRepo: ProductRepositoryPorts.ProductRepository,
    private readonly createEntitlementUseCase: CreateEntitlementUseCase,
    private readonly syncProductLimitsUseCase: SyncProductLimitsToEntitlementsUseCase,
    private readonly entitlementUpdateNotifier?: EntitlementUpdateNotifier,
    private readonly processedTokenChargesRepo?: ProcessedTokenChargesRepository,
  ) {}

  async execute(input: ChargeTokenInput): Promise<ChargeTokenOutput> {
    const { userId, priceId, idempotencyKey } = input;

    // check for cached response first before doing any processing, to handle duplicated requests with same idempotency key
    if (idempotencyKey && this.processedTokenChargesRepo) {
      const cachedResponse =
        await this.processedTokenChargesRepo.getCachedResponse<ChargeTokenOutput>(
          idempotencyKey,
        );
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    // Get price
    const price = await this.priceRepo.findById(priceId);
    if (!price) {
      throw new NotFoundError(`Price '${priceId}' not found`);
    }

    // Validate currency is "token"
    if (price.currency.toLowerCase() !== "token") {
      throw new DomainError(
        `Price '${priceId}' does not use token currency. Currency: ${price.currency}`,
      );
    }

    // Get product
    const product = await this.productRepo.findById(price.productId);
    if (!product) {
      throw new NotFoundError(`Product '${price.productId}' not found`);
    }

    // Get user's token entitlement
    let entitlement = await this.entitlementRepo.findByUserAndKey(
      userId,
      "token",
    );

    if (!entitlement) {
      throw new NotFoundError(
        `Token entitlement not found for user '${userId}'`,
      );
    }

    if (!entitlement.isActive()) {
      throw new DomainError(
        `Token entitlement is not active for user '${userId}'`,
      );
    }

    if (!entitlement.usage) {
      throw new DomainError(`Token entitlement is not usage-based`);
    }

    // Check rate limit before mutating any token state
    if (this.processedTokenChargesRepo) {
      const canCharge = await this.processedTokenChargesRepo.canCharge(userId);
      if (!canCharge) {
        const error = new DomainError(
          `Token purchases are rate limited for user '${userId}'`,
        );
        (error as any).code = "RATE_LIMITED";
        throw error;
      }
    }

    // Lazy evaluation: reset usage if period has passed
    if (entitlement.usage.shouldReset()) {
      entitlement.usage.reset();
      await this.entitlementRepo.update(entitlement);
      await this.entitlementUpdateNotifier?.notify(entitlement);
      // Re-fetch to ensure we have fresh usage
      const updated = await this.entitlementRepo.findByUserAndKey(
        userId,
        "token",
      );
      if (!updated?.usage) {
        throw new DomainError(`Token entitlement is not usage-based`);
      }
      entitlement = updated;
    }

    // Ensure usage is still defined after potential reset
    if (!entitlement.usage) {
      throw new DomainError(`Token entitlement is not usage-based`);
    }

    // Check if user has enough tokens
    const requiredAmount = price.amount;
    const availableTokens =
      entitlement.usage.getEffectiveLimit() - entitlement.usage.used;

    if (availableTokens < requiredAmount) {
      const error = new DomainError(
        `Insufficient tokens. Required: ${requiredAmount}, Available: ${availableTokens}`,
      );
      (error as any).code = "INSUFFICIENT_FUNDS";
      throw error;
    }

    // Decrement tokens by increasing used amount
    entitlement.usage.used += requiredAmount;
    await this.entitlementRepo.update(entitlement);
    await this.entitlementUpdateNotifier?.notify(entitlement);

    // Generate payment intent ID (for reference)
    const paymentIntentId = `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Apply product entitlements directly (no SQS) so the user gets access immediately
    await this.applyProductEntitlementsForOneTime(
      userId,
      product,
      ROLE_LEARNER,
    );

    // Get final token balance
    const finalEntitlement = await this.entitlementRepo.findByUserAndKey(
      userId,
      "token",
    );
    const remainingTokens =
      finalEntitlement && finalEntitlement.usage
        ? finalEntitlement.usage.getEffectiveLimit() -
          finalEntitlement.usage.used
        : 0;

    const result: ChargeTokenOutput = {
      success: true,
      paymentIntentId,
      amount: requiredAmount,
      remainingTokens,
    };

    if (idempotencyKey && this.processedTokenChargesRepo) {
      await this.processedTokenChargesRepo.saveCachedResponse(
        idempotencyKey,
        result,
      );
    }

    if (this.processedTokenChargesRepo) {
      await this.processedTokenChargesRepo.recordCharge(userId);
    }

    return result;
  }

  /**
   * Applies product entitlements for a one-time token purchase (same logic as entitlement-service
   * handlePaymentSuccessful for one_time), so the user gets access immediately without waiting for SQS.
   */
  private async applyProductEntitlementsForOneTime(
    userId: string,
    product: { productId: string; entitlements: readonly string[] },
    role: "learner",
  ): Promise<void> {
    for (const key of product.entitlements) {
      const entitlementKey = key as EntitlementKey;
      const existing = await this.entitlementRepo.findByUserAndKey(
        userId,
        entitlementKey,
      );
      if (existing) {
        existing.status = EntitlementStatus.ACTIVE;
        await this.entitlementRepo.update(existing);
      } else {
        await this.createEntitlementUseCase.execute({
          userId,
          key: entitlementKey,
          role,
          expiresAt: undefined,
        });
      }
    }
    await this.syncProductLimitsUseCase.execute({
      productId: product.productId,
      userId,
      isAddon: false,
      isOneTimePayment: true,
    });
  }
}
