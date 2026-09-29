import { ResetStrategy } from "../value-objects/reset-strategy.vo";

export class EntitlementUsage {
  constructor(
    public limit: number,
    public used: number,
    public resetAt?: Date,
    public resetStrategy?: ResetStrategy,
    public permanentLimit?: number, // Permanent limit from one-time payments that cannot be removed
  ) {}

  /**
   * Gets the effective limit (base limit + permanent limit from one-time payments)
   */
  getEffectiveLimit(): number {
    return this.limit + (this.permanentLimit || 0);
  }

  canConsume(amount = 1): boolean {
    if (amount < 0) return this.used + amount >= 0; // allow reducing usage (e.g. refunds) as long as it doesn't go below 0
    return this.used + amount <= this.getEffectiveLimit();
  }

  consume(amount = 1): void {
    if (!this.canConsume(amount)) {
      throw new Error("Entitlement usage exceeded");
    }
    this.used = Math.max(0, this.used + amount); // only increase usage for positive amounts
  }

  /**
   * Checks if the usage should be reset based on reset strategy or resetAt date
   */
  shouldReset(now = new Date()): boolean {
    // Manual reset - check resetAt date
    if (!this.resetStrategy || this.resetStrategy.type === "manual") {
      return this.resetAt ? now >= this.resetAt : false;
    }

    // Periodic reset - check if we've passed the reset period
    if (this.resetStrategy.type === "periodic" && this.resetAt) {
      return now >= this.resetAt;
    }

    // Rolling reset - always false (handled externally based on window)
    if (this.resetStrategy.type === "rolling") {
      return false;
    }

    return false;
  }

  /**
   * Resets the usage counter and calculates the next reset date
   */
  reset(now = new Date()): void {
    this.used = 0;

    if (!this.resetStrategy || this.resetStrategy.type === "manual") {
      // Manual reset - don't auto-calculate next reset
      this.resetAt = undefined;
      return;
    }

    // Calculate next reset date based on strategy
    this.resetAt = this.calculateNextResetDate(now);
  }

  /**
   * Calculates the next reset date based on the reset strategy
   */
  private calculateNextResetDate(now: Date): Date {
    if (!this.resetStrategy) {
      return now;
    }

    const nextReset = new Date(now);

    switch (this.resetStrategy.period) {
      case "hour":
        nextReset.setHours(nextReset.getHours() + 1);
        nextReset.setMinutes(0, 0, 0);
        break;

      case "day":
        nextReset.setDate(nextReset.getDate() + 1);
        nextReset.setHours(this.resetStrategy.hour || 0, 0, 0, 0);
        break;

      case "week":
        const daysUntilNextWeek =
          (7 - nextReset.getDay() + (this.resetStrategy.dayOfWeek || 0)) % 7 ||
          7;
        nextReset.setDate(nextReset.getDate() + daysUntilNextWeek);
        nextReset.setHours(this.resetStrategy.hour || 0, 0, 0, 0);
        break;

      case "month":
        nextReset.setMonth(nextReset.getMonth() + 1);
        nextReset.setDate(this.resetStrategy.dayOfMonth || 1);
        nextReset.setHours(this.resetStrategy.hour || 0, 0, 0, 0);
        break;

      case "quarter":
        nextReset.setMonth(nextReset.getMonth() + 3);
        nextReset.setDate(1);
        nextReset.setHours(this.resetStrategy.hour || 0, 0, 0, 0);
        break;

      case "year":
        nextReset.setFullYear(nextReset.getFullYear() + 1);
        nextReset.setMonth(0);
        nextReset.setDate(1);
        nextReset.setHours(this.resetStrategy.hour || 0, 0, 0, 0);
        break;

      case "custom":
        if (this.resetStrategy.customDays) {
          nextReset.setDate(
            nextReset.getDate() + this.resetStrategy.customDays,
          );
        }
        break;

      default:
        // Default to next day
        nextReset.setDate(nextReset.getDate() + 1);
        nextReset.setHours(0, 0, 0, 0);
    }

    return nextReset;
  }
}
