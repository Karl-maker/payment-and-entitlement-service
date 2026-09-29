import { DomainError } from "../errors/domain.error";
import { BillingType } from "../value-objects/billing-type.vo";
import { Interval } from "../value-objects/interval.vo";
import { isAllowedPriceCurrency } from "../value-objects/allowed-currencies";

export interface PriceProps {
  priceId: string;
  productId: string;
  billingType: BillingType;
  interval?: Interval; // Required for recurring, optional for one_time
  frequency?: number; // e.g., 1 for monthly, 2 for bi-monthly
  amount: number;
  currency: string;
  providers?: Record<string, string>; // provider name -> providerId
  createdAt: Date;
  updatedAt: Date;
}

export class Price {
  private readonly _priceId: string;
  private readonly _productId: string;
  private readonly _billingType: BillingType;
  private _interval?: Interval;
  private _frequency: number;
  private _amount: number;
  private _currency: string;
  private _providers: Record<string, string>;
  private _createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: PriceProps) {
    this._priceId = props.priceId;
    this._productId = props.productId;
    this._billingType = props.billingType;
    this._interval = props.interval;
    this._frequency = props.frequency ?? 1;
    this._amount = props.amount;
    this._currency = props.currency;
    this._providers = props.providers ?? {};
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;

    this.validate();
  }

  // ---------- FACTORY ----------

  static create(props: Omit<PriceProps, "createdAt" | "updatedAt">): Price {
    return new Price({
      ...props,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  // ---------- GETTERS ----------

  get priceId(): string {
    return this._priceId;
  }

  get productId(): string {
    return this._productId;
  }

  get billingType(): BillingType {
    return this._billingType;
  }

  get interval(): Interval | undefined {
    return this._interval;
  }

  get frequency(): number {
    return this._frequency;
  }

  get amount(): number {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get providers(): Record<string, string> {
    return { ...this._providers };
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ---------- BEHAVIOR ----------

  updateAmount(amount: number): void {
    if (amount < 0) {
      throw new DomainError("Amount cannot be negative");
    }
    this._amount = amount;
    this.touch();
  }

  updateCurrency(currency: string): void {
    const normalized = currency?.trim().toUpperCase() ?? "";
    if (!this.isValidCurrency(normalized)) {
      throw new DomainError("Currency must be a 3-letter code (e.g., USD) or 'token'");
    }
    this._currency = normalized;
    this.touch();
  }

  updateInterval(interval: Interval): void {
    if (this._billingType === BillingType.ONE_TIME) {
      throw new DomainError("One-time billing cannot have an interval");
    }
    this._interval = interval;
    this.touch();
  }

  updateFrequency(frequency: number): void {
    if (frequency < 1) {
      throw new DomainError("Frequency must be at least 1");
    }
    if (this._billingType === BillingType.ONE_TIME) {
      throw new DomainError("One-time billing cannot have a frequency");
    }
    this._frequency = frequency;
    this.touch();
  }

  addProvider(providerName: string, providerId: string): void {
    if (!providerName || !providerName.trim()) {
      throw new DomainError("Provider name cannot be empty");
    }
    if (!providerId || !providerId.trim()) {
      throw new DomainError("Provider ID cannot be empty");
    }
    this._providers[providerName.trim().toLowerCase()] = providerId.trim();
    this.touch();
  }

  updateProviders(providers: Record<string, string>): void {
    if (!providers || typeof providers !== 'object') {
      throw new DomainError("Providers must be a valid object");
    }
    // Validate all provider entries
    for (const [providerName, providerId] of Object.entries(providers)) {
      if (!providerName || !providerName.trim()) {
        throw new DomainError("Provider name cannot be empty");
      }
      if (!providerId || !providerId.trim()) {
        throw new DomainError("Provider ID cannot be empty");
      }
    }
    // Merge with existing providers (lowercase keys for consistency)
    const normalizedProviders: Record<string, string> = {};
    for (const [key, value] of Object.entries(providers)) {
      normalizedProviders[key.trim().toLowerCase()] = value.trim();
    }
    this._providers = { ...this._providers, ...normalizedProviders };
    this.touch();
  }

  removeProvider(providerName: string): void {
    const normalizedName = providerName.trim().toLowerCase();
    if (this._providers[normalizedName]) {
      delete this._providers[normalizedName];
      this.touch();
    }
  }

  // ---------- VALIDATION ----------

  private validate(): void {
    if (!this._priceId) {
      throw new DomainError("Price must have an ID");
    }

    if (!this._productId) {
      throw new DomainError("Price must have a product ID");
    }

    if (this._amount < 0) {
      throw new DomainError("Amount cannot be negative");
    }

    if (!this._currency || !this.isValidCurrency(this._currency.trim().toUpperCase())) {
      throw new DomainError("Currency must be a 3-letter code (e.g., USD) or 'token'");
    }

    if (this._billingType === BillingType.RECURRING && !this._interval) {
      throw new DomainError("Recurring billing must have an interval");
    }

    if (this._billingType === BillingType.ONE_TIME && this._interval) {
      throw new DomainError("One-time billing cannot have an interval");
    }

    if (this._frequency < 1) {
      throw new DomainError("Frequency must be at least 1");
    }
  }

  private touch(): void {
    this._updatedAt = new Date();
  }

  private isValidCurrency(currency: string): boolean {
    return isAllowedPriceCurrency(currency);
  }
}
