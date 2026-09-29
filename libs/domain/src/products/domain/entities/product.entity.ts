import { DomainError } from "../errors/domain.error";
import { EntitlementKey } from "../value-objects/entitlement-key.vo";
import { ProductType } from "../value-objects/product-type.vo";
import { UsageLimit } from "../value-objects/useage-limit.vo";
import { AddonConfig } from "../value-objects/addon-config.vo";

export interface ProductProps {
  productId: string;
  name: string;
  description?: string;
  type: ProductType;

  entitlements: EntitlementKey[];

  usageLimits?: UsageLimit[];

  addons?: string[]; // productIds of add-ons (legacy - use addonConfigs for new products)
  addonConfigs?: AddonConfig[]; // Enhanced add-on configuration

  providers?: Record<string, string>; // provider name -> providerId (e.g., "stripe" -> "prod_xxx", "paypal" -> "PP-xxx")
  targeting?: {
    countries?: string[]; // ISO country codes
    percentage?: number; // 0-100 for percentage-based targeting
    cidrBlocks?: string[]; // For IP-based targeting
  };
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export class Product {
  private readonly _productId: string;
  private _name: string;
  private _description?: string;
  private readonly _type: ProductType;
  private _entitlements: EntitlementKey[];
  private _usageLimits: UsageLimit[];
  private _addons: string[];
  private _addonConfigs: AddonConfig[];
  private _providers: Record<string, string>;
  private _targeting?: {
    countries?: string[];
    percentage?: number;
    cidrBlocks?: string[];
  };
  private _isActive: boolean;
  private _createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: ProductProps) {
    this._productId = props.productId;
    this._name = props.name;
    this._description = props.description;
    this._type = props.type;
    this._entitlements = props.entitlements;
    this._usageLimits = props.usageLimits ?? [];
    this._addons = props.addons ?? [];
    this._addonConfigs = props.addonConfigs ?? [];
    this._providers = props.providers ?? {};
    this._isActive = props.isActive;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._targeting = props.targeting;
    this.validate();
  }

  // ---------- FACTORY ----------

  static create(props: Omit<ProductProps, "createdAt" | "updatedAt">): Product {
    return new Product({
      ...props,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // ---------- GETTERS ----------

  get productId(): string {
    return this._productId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string | undefined {
    return this._description;
  }

  get type(): ProductType {
    return this._type;
  }

  get entitlements(): EntitlementKey[] {
    return [...this._entitlements];
  }

  get usageLimits(): UsageLimit[] {
    return [...this._usageLimits];
  }

  get addons(): string[] {
    return [...this._addons];
  }

  get addonConfigs(): AddonConfig[] {
    return [...this._addonConfigs];
  }

  get providers(): Record<string, string> {
    return { ...this._providers };
  }

  get targeting() {
    return this._targeting ? { ...this._targeting } : undefined;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ---------- BEHAVIOR ----------

  rename(name: string): void {
    if (!name || name.trim().length < 3) {
      throw new DomainError("Product name must be at least 3 characters");
    }
    this._name = name.trim();
    this.touch();
  }

  updateDescription(description?: string): void {
    this._description = description;
    this.touch();
  }

  activate(): void {
    this._isActive = true;
    this.touch();
  }

  deactivate(): void {
    this._isActive = false;
    this.touch();
  }

  addEntitlement(entitlement: EntitlementKey): void {
    if (this._entitlements.includes(entitlement)) return;
    this._entitlements.push(entitlement);
    this.touch();
  }

  removeEntitlement(entitlement: EntitlementKey): void {
    this._entitlements = this._entitlements.filter((e) => e !== entitlement);
    this.touch();
  }

  addUsageLimit(limit: UsageLimit): void {
    const exists = this._usageLimits.find(
      (l) => l.metric === limit.metric && l.period === limit.period,
    );

    if (exists) {
      throw new DomainError(
        `Usage limit for ${limit.metric}/${limit.period} already exists`,
      );
    }

    //  entitlement check - ensure the metric matches one of the product's entitlements
    if (!this._entitlements.includes(limit.metric as any)) {
      throw new DomainError(
        `Usage limit metric '${limit.metric}' must match one of the product entitlements`,
      );
    }

    this._usageLimits.push(limit);
    this.touch();
  }

  addAddon(productId: string): void {
    if (this._type !== ProductType.SUBSCRIPTION) {
      throw new DomainError("Only subscription products can have add-ons");
    }

    if (this._addons.includes(productId)) return;
    this._addons.push(productId);
    this.touch();
  }

  addAddonConfig(config: AddonConfig): void {
    if (this._type !== ProductType.SUBSCRIPTION) {
      throw new DomainError("Only subscription products can have add-ons");
    }

    // Check for conflicts
    if (config.conflicts) {
      const existingAddonIds = this._addonConfigs.map((c) => c.productId);
      const hasConflict = config.conflicts.some((conflictId) =>
        existingAddonIds.includes(conflictId),
      );
      if (hasConflict) {
        throw new DomainError(
          `Add-on ${config.productId} conflicts with existing add-ons`,
        );
      }
    }

    // Check if already exists
    const exists = this._addonConfigs.find(
      (c) => c.productId === config.productId,
    );
    if (exists) {
      throw new DomainError(
        `Add-on configuration for ${config.productId} already exists`,
      );
    }

    // Validate dependencies
    if (config.dependencies) {
      const existingAddonIds = this._addonConfigs.map((c) => c.productId);
      const missingDeps = config.dependencies.filter(
        (dep) => !existingAddonIds.includes(dep),
      );
      if (missingDeps.length > 0) {
        throw new DomainError(
          `Add-on ${config.productId} requires dependencies: ${missingDeps.join(", ")}`,
        );
      }
    }

    this._addonConfigs.push(config);
    // Also add to legacy addons array for backward compatibility
    if (!this._addons.includes(config.productId)) {
      this._addons.push(config.productId);
    }
    this.touch();
  }

  removeAddonConfig(productId: string): void {
    this._addonConfigs = this._addonConfigs.filter(
      (c) => c.productId !== productId,
    );
    // Remove from legacy array if not referenced by other configs
    const stillReferenced = this._addonConfigs.some(
      (c) => c.productId === productId,
    );
    if (!stillReferenced) {
      this._addons = this._addons.filter((id) => id !== productId);
    }
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
    if (!providers || typeof providers !== "object") {
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
    if (!this._productId) {
      throw new DomainError("Product must have an ID");
    }

    if (!this._name || this._name.trim().length < 3) {
      throw new DomainError("Product name must be at least 3 characters");
    }

    if (this._entitlements.length === 0) {
      throw new DomainError("Product must define at least one entitlement");
    }

    if (
      this._targeting?.percentage !== undefined && // added percentage validation
      (this._targeting.percentage < 0 || this._targeting.percentage > 100)
    ) {
      throw new DomainError(
        "Product targeting percentage must be between 0 and 100",
      );
    }

    const invalidUsageMetrics = this._usageLimits // added invalid usage limits check
      .map((limit) => limit.metric)
      .filter((metric) => !this._entitlements.includes(metric));

    if (invalidUsageMetrics.length > 0) {
      throw new DomainError(
        `Usage limits must match entitlements. Invalid metrics: ${invalidUsageMetrics.join(", ")}`,
      );
    }

    if (this._type === ProductType.ADDON && this._addons.length > 0) {
      throw new DomainError("Add-on products cannot have add-ons");
    }
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
