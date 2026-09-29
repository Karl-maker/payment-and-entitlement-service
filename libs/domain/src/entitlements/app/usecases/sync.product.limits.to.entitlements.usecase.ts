import { EntitlementRepository } from "../ports/entitlement.repository";
import type { EntitlementUpdateNotifier } from "../ports/entitlement-update-notifier.port";
import { ProductRepository } from "../../../products/app/ports/product.repository.port";
import { ResetStrategy } from "../../domain/value-objects/reset-strategy.vo";
import { UsagePeriod } from "../../../products/domain/value-objects/useage-limit.vo";
import { EntitlementUsage } from "../../domain/entities/entitlement-usage.entity";

export interface SyncProductLimitsInput {
  productId: string;
  userId: string;
  isAddon?: boolean; // If true, limits are added to existing limits instead of overwriting
  isOneTimePayment?: boolean; // If true, limits are added as permanent limits that cannot be removed
}

export class SyncProductLimitsToEntitlementsUseCase {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly entitlementRepo: EntitlementRepository,
    private readonly entitlementUpdateNotifier?: EntitlementUpdateNotifier
  ) {}

  async execute(input: SyncProductLimitsInput): Promise<void> {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      throw new Error(`Product ${input.productId} not found`);
    }

    const entitlements = await this.entitlementRepo.findByUser(input.userId);
    const isAddon = input.isAddon || false;
    const isOneTimePayment = input.isOneTimePayment || false;

    // For each usage limit in the product, sync to corresponding entitlements
    for (const usageLimit of product.usageLimits) {
      // Find entitlement that matches the metric
      const entitlement = entitlements.find(e => e.key === usageLimit.metric);
      
      if (!entitlement) {
        // Entitlement doesn't exist yet - would need to be created separately
        continue;
      }

      // For one-time payments, don't reset usage - permanent limits accumulate
      // For subscriptions, check if usage should be reset before updating
      const shouldReset = !isOneTimePayment && (entitlement.usage?.shouldReset() || false);
      if (shouldReset && entitlement.usage) {
        entitlement.usage.reset();
        console.log(`Reset usage for entitlement ${entitlement.key} before syncing limits`);
      }

      // Update entitlement usage limit
      const resetStrategy = this.createResetStrategyFromPeriod(usageLimit.period);
      
      // Determine if this limit should always increment (for certain reset types)
      // Lifetime and one-time purchases always increment
      const shouldAlwaysIncrement = isOneTimePayment || usageLimit.period === "lifetime";
      
      if (entitlement.usage) {
        // Update existing usage
        const currentUsed = entitlement.usage.used;
        
        if (isOneTimePayment) {
          // One-time payment: Add to permanent limit (cannot be removed)
          // Permanent limits persist even if subscription is canceled
          const currentPermanentLimit = entitlement.usage.permanentLimit || 0;
          entitlement.usage.permanentLimit = currentPermanentLimit + usageLimit.limit;
          console.log(`One-time payment ${input.productId}: Added ${usageLimit.limit} to permanent limit for ${entitlement.key}, permanent limit: ${entitlement.usage.permanentLimit}`);
        } else if (isAddon || shouldAlwaysIncrement) {
          // Add-on or always-increment: Add to existing limit (additive)
          entitlement.usage.limit = entitlement.usage.limit + usageLimit.limit;
          console.log(`${isAddon ? 'Add-on' : 'Product'} ${input.productId}: Added ${usageLimit.limit} to ${entitlement.key}, new limit: ${entitlement.usage.limit}`);
        } else {
          // Base product subscription: Set limit (overwrite)
          entitlement.usage.limit = usageLimit.limit;
        }
        
        // For one-time payments, don't update reset strategy (keep existing if any)
        // For subscriptions, update reset strategy
        if (!isOneTimePayment) {
          // Update reset strategy (use the most frequent reset if multiple products have same entitlement)
          // For billing_cycle, keep existing strategy if it's already billing_cycle
          if (resetStrategy && resetStrategy.period === "billing_cycle") {
            entitlement.usage.resetStrategy = resetStrategy;
          } else if (resetStrategy && (!entitlement.usage.resetStrategy || entitlement.usage.resetStrategy.period !== "billing_cycle")) {
            entitlement.usage.resetStrategy = resetStrategy;
          }
          
          // Calculate next reset date
          if (entitlement.usage.resetStrategy && entitlement.usage.resetStrategy.type === "periodic") {
            // If we just reset, resetAt was already calculated by reset()
            // For billing_cycle, don't calculate here - it will be set from subscription period end
            if (!shouldReset && entitlement.usage.resetStrategy.period !== "billing_cycle") {
              entitlement.usage.resetAt = this.calculateNextResetDate(entitlement.usage.resetStrategy, new Date());
            }
            // If billing_cycle and resetAt is not set, it will be set when subscription renews
          } else {
            entitlement.usage.resetAt = undefined;
          }
        }
        
        // Preserve used count (unless we just reset it)
        if (!shouldReset) {
          entitlement.usage.used = currentUsed;
        }
      } else {
        // Create new usage tracking
        if (isOneTimePayment) {
          // One-time payment: Set permanent limit, no reset strategy
          entitlement.usage = new EntitlementUsage(
            0, // Base limit is 0 for one-time payments
            0,
            undefined, // No reset date for one-time payments
            undefined, // No reset strategy for one-time payments
            usageLimit.limit // Permanent limit
          );
        } else {
          // Subscription: Create with reset strategy
          const resetAt = resetStrategy && resetStrategy.type === "periodic" 
            ? this.calculateNextResetDate(resetStrategy, new Date())
            : undefined;
          
          entitlement.usage = new EntitlementUsage(
            usageLimit.limit,
            0,
            resetAt,
            resetStrategy
          );
        }
      }

      await this.entitlementRepo.update(entitlement);
      await this.entitlementUpdateNotifier?.notify(entitlement);
    }
  }

  private createResetStrategyFromPeriod(period: UsagePeriod): ResetStrategy | undefined {
    switch (period) {
      case "day":
        return {
          type: "periodic",
          period: "day",
          hour: 0
        };
      case "week":
        return {
          type: "periodic",
          period: "week",
          dayOfWeek: 0, // Sunday
          hour: 0
        };
      case "month":
        return {
          type: "periodic",
          period: "month",
          dayOfMonth: 1,
          hour: 0
        };
      case "year":
        return {
          type: "periodic",
          period: "year",
          hour: 0
        };
      case "billing_cycle":
        return {
          type: "periodic",
          period: "billing_cycle"
        };
      case "lifetime":
        return undefined; // No reset for lifetime
      default:
        return undefined;
    }
  }

  private calculateNextResetDate(strategy: ResetStrategy, now: Date): Date {
    const nextReset = new Date(now);

    switch (strategy.period) {
      case "day":
        nextReset.setDate(nextReset.getDate() + 1);
        nextReset.setHours(strategy.hour || 0, 0, 0, 0);
        break;
      case "week":
        const daysUntilNextWeek = (7 - nextReset.getDay() + (strategy.dayOfWeek || 0)) % 7 || 7;
        nextReset.setDate(nextReset.getDate() + daysUntilNextWeek);
        nextReset.setHours(strategy.hour || 0, 0, 0, 0);
        break;
      case "month":
        nextReset.setMonth(nextReset.getMonth() + 1);
        nextReset.setDate(strategy.dayOfMonth || 1);
        nextReset.setHours(strategy.hour || 0, 0, 0, 0);
        break;
      case "year":
        nextReset.setFullYear(nextReset.getFullYear() + 1);
        nextReset.setMonth(0);
        nextReset.setDate(1);
        nextReset.setHours(strategy.hour || 0, 0, 0, 0);
        break;
      case "billing_cycle":
        // For billing_cycle, we can't calculate the next reset date here
        // It will be set when the subscription renews (based on currentPeriodEnd)
        // Return a far future date as placeholder - actual reset happens on subscription.updated
        nextReset.setFullYear(nextReset.getFullYear() + 10);
        break;
      default:
        nextReset.setDate(nextReset.getDate() + 1);
    }

    return nextReset;
  }
}
