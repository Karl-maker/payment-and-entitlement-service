import {
  EntitlementRepository,
  EntitlementRole,
  EntitlementStatus,
  EntitlementKey,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  ProductRepositoryPorts,
  BillingEvent,
  DunningRepository,
  DunningState,
} from "@libs/domain";
import { EntitlementEventPublisher } from "../../infrastructure/event.publisher";
import { ProcessedPaymentsRepository } from "../../infrastructure/processed-payments.repository";

type BillingDomainEvent<T = any> = BillingEvent.BillingDomainEvent<T>;
type SubscriptionCreatedEvent = BillingEvent.SubscriptionCreatedEvent;
type SubscriptionUpdatedEvent = BillingEvent.SubscriptionUpdatedEvent;
type SubscriptionCanceledEvent = BillingEvent.SubscriptionCanceledEvent;
type SubscriptionExpiredEvent = BillingEvent.SubscriptionExpiredEvent;
type SubscriptionPausedEvent = BillingEvent.SubscriptionPausedEvent;
type SubscriptionResumedEvent = BillingEvent.SubscriptionResumedEvent;
type PaymentSuccessfulEvent = BillingEvent.PaymentSuccessfulEvent;
const PaymentEventType = BillingEvent.PaymentEventType;
const SubscriptionEventType = BillingEvent.SubscriptionEventType;

export class ProcessBillingEventUseCase {
  constructor(
    private readonly createEntitlementUseCase: CreateEntitlementUseCase,
    private readonly syncProductLimitsUseCase: SyncProductLimitsToEntitlementsUseCase,
    private readonly eventPublisher: EntitlementEventPublisher,
    private readonly entitlementRepo: EntitlementRepository,
    private readonly productRepo: ProductRepositoryPorts.ProductRepository,
    private readonly dunningRepo?: DunningRepository, // Optional - only check if available
    private readonly processedPaymentsRepo?: ProcessedPaymentsRepository, // Optional - idempotency for one-off payments
  ) {}

  async execute(event: BillingDomainEvent<any>): Promise<void> {
    // Filter out payment failure events - these are handled by dunning service
    // Entitlement service should NOT revoke access on payment failures
    // Dunning service will handle the timeline and revoke only when SUSPENDED
    if (
      event.type === PaymentEventType.PAYMENT_FAILED ||
      event.type === PaymentEventType.PAYMENT_ACTION_REQUIRED
    ) {
      console.log(
        `Skipping payment failure event: ${event.type} - handled by dunning service`,
      );
      return;
    }

    const role = this.extractRole(event);
    if (!role) {
      console.warn(
        `No role found in event ${event.type}, defaulting to LEARNER`,
      );
    }

    switch (event.type) {
      case SubscriptionEventType.SUBSCRIPTION_CREATED:
        await this.handleSubscriptionCreated(
          event as SubscriptionCreatedEvent,
          role,
        );
        break;
      case SubscriptionEventType.SUBSCRIPTION_UPDATED:
        await this.handleSubscriptionUpdated(
          event as SubscriptionUpdatedEvent,
          role,
        );
        break;
      case SubscriptionEventType.SUBSCRIPTION_CANCELED:
        await this.handleSubscriptionCanceled(
          event as SubscriptionCanceledEvent,
        );
        break;
      case SubscriptionEventType.SUBSCRIPTION_EXPIRED:
        await this.handleSubscriptionExpired(event as SubscriptionExpiredEvent);
        break;
      case SubscriptionEventType.SUBSCRIPTION_PAUSED:
        await this.handleSubscriptionPaused(event as SubscriptionPausedEvent);
        break;
      case SubscriptionEventType.SUBSCRIPTION_RESUMED:
        await this.handleSubscriptionResumed(event as SubscriptionResumedEvent);
        break;
      case PaymentEventType.PAYMENT_SUCCESSFUL:
        await this.handlePaymentSuccessful(
          event as PaymentSuccessfulEvent,
          role,
        );
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  private extractRole(event: BillingDomainEvent<any>): EntitlementRole {
    // Role is not in event payload, default to LEARNER
    console.log(event);
    // In the future, this could fetch from a user service
    return "learner";
  }

  private async handleSubscriptionCreated(
    event: SubscriptionCreatedEvent,
    role: EntitlementRole,
  ): Promise<void> {
    const { userId, productId, currentPeriodEnd, addonProductIds } =
      event.payload;
    const expiresAt = new Date(currentPeriodEnd);

    // Create entitlements from product (not a renewal, it's a new subscription)
    await this.createEntitlementsFromProduct(
      userId,
      productId,
      role,
      expiresAt,
      false,
    );

    // Process add-ons from event payload (if provided) or from product configuration
    if (addonProductIds && addonProductIds.length > 0) {
      // Process add-ons specified in the event (from Stripe subscription items)
      for (const addonProductId of addonProductIds) {
        await this.processAddonProduct(
          userId,
          addonProductId,
          role,
          expiresAt,
          false,
        );
      }
    } else {
      // Fallback: process add-ons from product configuration (legacy behavior)
      await this.processAddons(userId, productId, role, expiresAt, false);
    }

    // Publish events for created entitlements
    await this.publishEntitlementEvents(
      userId,
      productId,
      "subscription.created",
      event.meta,
    );
  }

  private async handleSubscriptionUpdated(
    event: SubscriptionUpdatedEvent,
    role: EntitlementRole,
  ): Promise<void> {
    const {
      userId,
      productId,
      previousProductId,
      currentPeriodStart,
      currentPeriodEnd,
      addonProductIds,
    } = event.payload;
    const expiresAt = new Date(currentPeriodEnd);
    const newPeriodStart = new Date(currentPeriodStart);

    // If subscription was updated to a different product, remove entitlements from the old product
    // This prevents double billing and ensures user only has entitlements from the new subscription
    if (previousProductId && previousProductId !== productId) {
      console.log(
        `Subscription updated from product ${previousProductId} to ${productId}. Removing entitlements from old product.`,
      );

      // Revoke entitlements from the old product immediately
      // This removes what the last subscription provided
      await this.revokeEntitlements(userId, previousProductId, true);
    }

    // Detect if this is a billing cycle renewal (new period started)
    const isRenewal = await this.isBillingCycleRenewal(
      userId,
      productId,
      newPeriodStart,
    );

    // Update entitlements (recreate/update) for the new product
    await this.createEntitlementsFromProduct(
      userId,
      productId,
      role,
      expiresAt,
      isRenewal,
    );

    // Process add-ons from event payload (if provided) or from product configuration
    if (addonProductIds && addonProductIds.length > 0) {
      // Process add-ons specified in the event (from Stripe subscription items)
      // These are the add-ons that are actually attached to the Stripe subscription
      for (const addonProductId of addonProductIds) {
        await this.processAddonProduct(
          userId,
          addonProductId,
          role,
          expiresAt,
          isRenewal,
        );
      }
    } else {
      // Fallback: process add-ons from product configuration (legacy behavior)
      // This handles cases where add-ons aren't explicitly provided in the event
      await this.processAddons(userId, productId, role, expiresAt, isRenewal);
    }

    await this.publishEntitlementEvents(
      userId,
      productId,
      "subscription.updated",
      event.meta,
    );
  }

  private async handleSubscriptionCanceled(
    event: SubscriptionCanceledEvent,
  ): Promise<void> {
    const { userId, productId, cancelAtPeriodEnd, currentPeriodEnd } =
      event.payload;

    if (cancelAtPeriodEnd) {
      // Revoke at period end
      const expiresAt = new Date(currentPeriodEnd);
      await this.revokeEntitlements(userId, productId, false, expiresAt);
    } else {
      // Revoke immediately
      await this.revokeEntitlements(userId, productId, true);
    }

    await this.publishEntitlementEvents(
      userId,
      productId,
      "subscription.canceled",
      event.meta,
    );
  }

  private async handleSubscriptionExpired(
    event: SubscriptionExpiredEvent,
  ): Promise<void> {
    const { userId, productId } = event.payload;

    await this.revokeEntitlements(userId, productId, true);

    await this.publishEntitlementEvents(
      userId,
      productId,
      "subscription.expired",
      event.meta,
    );
  }

  private async handleSubscriptionPaused(
    event: SubscriptionPausedEvent,
  ): Promise<void> {
    // Paused subscriptions keep entitlements but mark as inactive
    // This would require a new use case to update status only
    // For now, we'll leave entitlements active but they won't reset
    console.log(
      `Subscription paused for user ${event.payload.userId}, entitlements remain active`,
    );
  }

  private async handleSubscriptionResumed(
    event: SubscriptionResumedEvent,
  ): Promise<void> {
    const { userId, productId, currentPeriodEnd } = event.payload;
    const expiresAt = new Date(currentPeriodEnd);
    const userRole: EntitlementRole = "learner"; // Default role

    // Re-activate entitlements (not a renewal, just resuming)
    await this.createEntitlementsFromProduct(
      userId,
      productId,
      userRole,
      expiresAt,
      false,
    );

    await this.publishEntitlementEvents(
      userId,
      productId,
      "subscription.resumed",
      event.meta,
    );
  }

  private async handlePaymentSuccessful(
    event: PaymentSuccessfulEvent,
    role: EntitlementRole,
  ): Promise<void> {
    const { userId, productId, billingType, paymentIntentId } = event.payload;

    if (!productId) {
      console.log(
        `Payment successful but no productId, skipping entitlement creation`,
      );
      return;
    }

    // Check if this is a one-time payment
    const isOneTime =
      billingType === "one_time" || !event.payload.subscriptionId;

    // Idempotency: one-off payments must only add usage once per paymentIntentId
    if (isOneTime && paymentIntentId && this.processedPaymentsRepo) {
      const alreadyProcessed =
        await this.processedPaymentsRepo.isPaymentProcessed(paymentIntentId);
      if (alreadyProcessed) {
        console.log(
          `One-off payment ${paymentIntentId} already applied, skipping duplicate`,
        );
        return;
      }
    }

    if (isOneTime) {
      // For one-time payments:
      // 1. Create entitlements without expiration (lifetime access)
      // 2. Apply permanent limits that cannot be removed even if subscription is canceled
      // 3. If entitlement already exists with expiration, keep expiration but add permanent limit
      await this.createEntitlementsFromProduct(
        userId,
        productId,
        role,
        undefined,
        false,
        true,
      );
    } else {
      // For subscription payments, create entitlements with expiration
      await this.createEntitlementsFromProduct(
        userId,
        productId,
        role,
        undefined,
        false,
        false,
      );
    }

    // Mark one-off payment as processed so duplicates (e.g. checkout + payment_intent.succeeded) don't add again
    if (isOneTime && paymentIntentId && this.processedPaymentsRepo) {
      await this.processedPaymentsRepo.markPaymentProcessed(paymentIntentId);
    }

    await this.publishEntitlementEvents(
      userId,
      productId,
      "payment.successful",
      event.meta,
    );
  }

  private async publishEntitlementEvents(
    userId: string,
    productId: string,
    reason: string,
    metadata: any,
  ): Promise<void> {
    try {
      // Fetch entitlements for the user
      const entitlements = await this.entitlementRepo.findByUser(userId);

      // Publish events for each entitlement
      for (const entitlement of entitlements) {
        const status: "active" | "inactive" =
          entitlement.status === EntitlementStatus.ACTIVE
            ? "active"
            : "inactive";

        const payload = {
          userId: entitlement.userId,
          entitlementKey: entitlement.key as string,
          role: entitlement.role as string,
          status,
          expiresAt: entitlement.expiresAt?.toISOString(),
          usageLimit: entitlement.usage
            ? {
                limit: entitlement.usage.limit,
                used: entitlement.usage.used,
              }
            : undefined,
          productId,
          reason,
        };

        // Determine event type based on reason
        if (reason.includes("created") || reason.includes("successful")) {
          await this.eventPublisher.publishCreated(payload, metadata);
        } else if (reason.includes("updated") || reason.includes("resumed")) {
          await this.eventPublisher.publishUpdated(payload, metadata);
        } else if (
          reason.includes("canceled") ||
          reason.includes("expired") ||
          reason.includes("revoked")
        ) {
          await this.eventPublisher.publishRevoked(payload, metadata);
        }
      }
    } catch (error) {
      console.error("Error publishing entitlement events:", error);
      // Don't throw - event publishing failure shouldn't fail the main process
    }
  }

  /**
   * Creates entitlements for a user based on a product
   * @param isOneTimePayment - If true, creates entitlements without expiration and with permanent limits
   */
  private async createEntitlementsFromProduct(
    userId: string,
    productId: string,
    role: EntitlementRole,
    expiresAt?: Date,
    isRenewal = false,
    isOneTimePayment = false,
  ): Promise<void> {
    // Get product details
    const product = await this.productRepo.findById(productId);

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    // Create entitlements for each entitlement key in the product
    for (const entitlementKey of product.entitlements) {
      // Check if entitlement already exists
      const existing = await this.entitlementRepo.findByUserAndKey(
        userId,
        entitlementKey,
      );

      if (existing) {
        // Update existing entitlement
        existing.status = EntitlementStatus.ACTIVE;

        // For one-time payments: don't set expiration (keep lifetime access)
        // For subscriptions: set expiration if provided
        if (isOneTimePayment) {
          // One-time payment: keep existing expiration if it exists (from previous subscription)
          // Don't overwrite with undefined - preserve lifetime access
          // If there's no expiration, keep it that way (lifetime)
        } else if (expiresAt) {
          // Subscription: update expiration
          existing.expiresAt = expiresAt;
        }

        // Reset usage if billing cycle renewed and entitlement has billing_cycle reset strategy
        // Skip reset for one-time payments
        if (
          !isOneTimePayment &&
          isRenewal &&
          existing.usage?.resetStrategy?.period === "billing_cycle"
        ) {
          // Reset usage and set next reset date to the new period end
          existing.usage.reset();
          if (expiresAt) {
            existing.usage.resetAt = expiresAt;
          }
          console.log(
            `Reset usage for entitlement ${entitlementKey} due to billing cycle renewal, next reset: ${expiresAt?.toISOString()}`,
          );
        } else if (
          !isOneTimePayment &&
          existing.usage &&
          existing.usage.shouldReset()
        ) {
          // Check and reset for other periodic resets (day, week, month, etc.)
          existing.usage.reset();
          console.log(
            `Reset usage for entitlement ${entitlementKey} due to reset period`,
          );
        } else if (
          !isOneTimePayment &&
          isRenewal &&
          existing.usage &&
          expiresAt
        ) {
          // Even if not billing_cycle, update resetAt if it's a renewal and we have expiresAt
          // This ensures billing_cycle resets are scheduled correctly
          if (existing.usage.resetStrategy?.period === "billing_cycle") {
            existing.usage.resetAt = expiresAt;
          }
        }

        await this.entitlementRepo.update(existing);
        await this.eventPublisher.publishAvailabilityFromEntitlement(existing);
      } else {
        // Create new entitlement
        // For one-time payments: no expiration (lifetime access)
        // For subscriptions: use provided expiration
        await this.createEntitlementUseCase.execute({
          userId,
          key: entitlementKey as EntitlementKey,
          role,
          expiresAt: isOneTimePayment ? undefined : expiresAt,
        });
      }
    }

    // Sync product usage limits to entitlements (will handle additive logic for add-ons)
    await this.syncProductLimitsUseCase.execute({
      productId,
      userId,
      isAddon: false, // Base product, not add-on
      isOneTimePayment, // Pass flag for one-time payments
    });
  }

  /**
   * Processes add-ons for a product subscription
   * Add-ons are processed additively - they increase limits rather than overwrite
   */
  private async processAddons(
    userId: string,
    productId: string,
    role: EntitlementRole,
    expiresAt?: Date,
    isRenewal = false,
  ): Promise<void> {
    const product = await this.productRepo.findById(productId);

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    // Process addonConfigs (preferred) or legacy addons
    const addonConfigs = product.addonConfigs || [];
    const legacyAddons = product.addons || [];

    // Process addonConfigs
    for (const addonConfig of addonConfigs) {
      await this.processAddonProduct(
        userId,
        addonConfig.productId,
        role,
        expiresAt,
        isRenewal,
      );
    }

    // Process legacy addons
    for (const addonProductId of legacyAddons) {
      await this.processAddonProduct(
        userId,
        addonProductId,
        role,
        expiresAt,
        isRenewal,
      );
    }
  }

  /**
   * Processes a single add-on product with additive limit logic
   */
  private async processAddonProduct(
    userId: string,
    addonProductId: string,
    role: EntitlementRole,
    expiresAt?: Date,
    isRenewal = false,
  ): Promise<void> {
    const addonProduct = await this.productRepo.findById(addonProductId);

    if (!addonProduct) {
      console.warn(`Add-on product ${addonProductId} not found, skipping`);
      return;
    }

    // Create entitlements for add-on (if they don't exist)
    for (const entitlementKey of addonProduct.entitlements) {
      const existing = await this.entitlementRepo.findByUserAndKey(
        userId,
        entitlementKey,
      );

      if (!existing) {
        // Create new entitlement for add-on feature
        await this.createEntitlementUseCase.execute({
          userId,
          key: entitlementKey as EntitlementKey,
          role,
          expiresAt,
        });
      } else {
        // Update existing entitlement
        existing.status = EntitlementStatus.ACTIVE;
        if (expiresAt) {
          existing.expiresAt = expiresAt;
        }

        // Reset usage if billing cycle renewed
        if (
          isRenewal &&
          existing.usage?.resetStrategy?.period === "billing_cycle"
        ) {
          existing.usage.reset();
          if (expiresAt) {
            existing.usage.resetAt = expiresAt;
          }
          console.log(
            `Reset usage for add-on entitlement ${entitlementKey} due to billing cycle renewal`,
          );
        } else if (existing.usage && existing.usage.shouldReset()) {
          existing.usage.reset();
        } else if (isRenewal && existing.usage && expiresAt) {
          // Update resetAt for billing_cycle even if we didn't reset
          if (existing.usage.resetStrategy?.period === "billing_cycle") {
            existing.usage.resetAt = expiresAt;
          }
        }

        await this.entitlementRepo.update(existing);
        await this.eventPublisher.publishAvailabilityFromEntitlement(existing);
      }
    }

    // Sync add-on limits additively (increases existing limits)
    await this.syncProductLimitsUseCase.execute({
      productId: addonProductId,
      userId,
      isAddon: true, // Mark as add-on for additive logic
    });
  }

  /**
   * Detects if a subscription update represents a billing cycle renewal
   * A renewal occurs when the new period start is at or after the previous period end
   *
   * Logic:
   * - If entitlement.expiresAt (previous period end) exists and newPeriodStart >= expiresAt, it's a renewal
   * - This means the subscription has moved to a new billing period
   */
  private async isBillingCycleRenewal(
    userId: string,
    productId: string,
    newPeriodStart: Date,
  ): Promise<boolean> {
    try {
      // Get product to find its entitlements
      const product = await this.productRepo.findById(productId);
      if (!product) {
        return false;
      }

      // Check if any entitlement's expiresAt (previous period end) is at or before new period start
      // If newPeriodStart >= expiresAt, the subscription has moved to a new billing period
      for (const entitlementKey of product.entitlements) {
        const entitlement = await this.entitlementRepo.findByUserAndKey(
          userId,
          entitlementKey,
        );

        if (entitlement?.expiresAt) {
          // Allow small buffer (1 second) to handle timing edge cases
          const timeDiff =
            newPeriodStart.getTime() - entitlement.expiresAt.getTime();
          // If new period start is at or after previous period end (within 1 second tolerance), it's a renewal
          if (timeDiff >= -1000) {
            console.log(
              `Billing cycle renewal detected: newPeriodStart=${newPeriodStart.toISOString()}, previousExpiresAt=${entitlement.expiresAt.toISOString()}`,
            );
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error(`Error detecting billing cycle renewal:`, error);
      // Default to false on error to avoid false resets
      return false;
    }
  }

  /**
   * Revokes entitlements for a user based on a product
   * Checks dunning state to ensure we don't revoke prematurely
   */
  private async revokeEntitlements(
    userId: string,
    productId: string,
    immediate: boolean,
    expiresAt?: Date,
  ): Promise<void> {
    // Check dunning state before revoking (using libs/domain)
    // Dunning timeline: ACTION_REQUIRED (Day 0) → GRACE_PERIOD (Day 1-3) → RESTRICTED (Day 4-7) → SUSPENDED (Day 8+)
    // Only revoke if dunning state is OK (no billing issues) or SUSPENDED (8+ days, already suspended)
    // If in ACTION_REQUIRED, GRACE_PERIOD, or RESTRICTED (Days 0-7), maintain access per 8-day grace period
    // This ensures entitlements are maintained during the dunning grace period and only revoked after 8 days
    if (this.dunningRepo) {
      const dunningRecord = await this.dunningRepo.findByUserId(userId);
      if (dunningRecord) {
        const state = dunningRecord.state;
        const daysSince = dunningRecord.getDaysSinceDetection();

        // Check if state should transition (in case dunning service hasn't processed it yet)
        if (dunningRecord.shouldTransition()) {
          const nextState = dunningRecord.getNextState();
          if (nextState !== state) {
            // State should have transitioned - use the next state for decision
            if (
              nextState === DunningState.SUSPENDED ||
              nextState === DunningState.OK
            ) {
              // Proceed with revocation if state should be SUSPENDED or OK
            } else {
              console.log(
                `Skipping entitlement revocation for user ${userId} - dunning state should be ${nextState} (${daysSince} days since detection). Access maintained per 8-day dunning timeline.`,
              );
              return;
            }
          }
        }

        // Check current state
        if (
          state === DunningState.ACTION_REQUIRED ||
          state === DunningState.GRACE_PERIOD ||
          state === DunningState.RESTRICTED
        ) {
          console.log(
            `Skipping entitlement revocation for user ${userId} - dunning state is ${state} (${daysSince} days since detection). Access maintained per 8-day dunning timeline.`,
          );
          return; // Don't revoke - maintain access during grace period (Days 0-7)
        }
        // If SUSPENDED (Day 8+), proceed with revocation
        // If OK, proceed with revocation (normal subscription cancellation/expiration)
      }
    }

    const product = await this.productRepo.findById(productId);

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    // Revoke entitlements for each entitlement key in the product
    // IMPORTANT: Permanent limits from one-time payments are NEVER removed
    for (const entitlementKey of product.entitlements) {
      const entitlement = await this.entitlementRepo.findByUserAndKey(
        userId,
        entitlementKey,
      );

      if (entitlement) {
        if (immediate) {
          // Check if user has permanentLimit from one-off payments
          const hasPermanentLimit =
            entitlement.usage?.permanentLimit &&
            entitlement.usage.permanentLimit > 0;

          if (hasPermanentLimit) {
            // User has one-off credits: keep entitlement ACTIVE so they can use permanentLimit
            // Only remove subscription limit, preserve permanentLimit
            entitlement.status = EntitlementStatus.ACTIVE;
            entitlement.expiresAt = undefined; // No expiration for permanent access

            if (entitlement.usage) {
              entitlement.usage.limit = 0; // Remove subscription limit
              // permanentLimit is preserved - never removed
              entitlement.usage.resetStrategy = undefined; // Remove reset strategy
              entitlement.usage.resetAt = undefined; // Remove reset date
            }

            console.log(
              `Subscription expired for user ${userId}, entitlement ${entitlementKey}: Keeping ACTIVE due to permanentLimit ${entitlement.usage?.permanentLimit}`,
            );
          } else {
            // No permanentLimit: revoke entitlement completely
            entitlement.status = EntitlementStatus.REVOKED;
            entitlement.expiresAt = undefined;

            // Remove regular limit (from subscriptions) but preserve permanent limit (from one-time payments)
            if (entitlement.usage) {
              entitlement.usage.limit = 0; // Remove subscription limit
              // permanentLimit is preserved - never removed
              entitlement.usage.resetStrategy = undefined; // Remove reset strategy
              entitlement.usage.resetAt = undefined; // Remove reset date
            }
          }
        } else if (expiresAt) {
          // Set expiration date but keep active until then
          entitlement.expiresAt = expiresAt;
          // Limits remain until expiration
        }
        await this.entitlementRepo.update(entitlement);
        await this.eventPublisher.publishAvailabilityFromEntitlement(
          entitlement,
        );
      }
    }

    // Also revoke add-on entitlements
    const addonConfigs = product.addonConfigs || [];
    const legacyAddons = product.addons || [];

    for (const addonConfig of addonConfigs) {
      await this.revokeEntitlements(
        userId,
        addonConfig.productId,
        immediate,
        expiresAt,
      );
    }

    for (const addonProductId of legacyAddons) {
      await this.revokeEntitlements(
        userId,
        addonProductId,
        immediate,
        expiresAt,
      );
    }
  }
}
