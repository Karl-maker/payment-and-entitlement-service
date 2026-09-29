import {
  DynamoEntitlementRepository,
  DynamoProductRepository,
  Product,
  ProductMapper,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  ProductRepositoryPorts,
  DynamoDunningRepository,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { ProcessBillingEventUseCase } from "./app/usecases/process.billing.event.usecase";
import { EntitlementEventPublisher } from "./infrastructure/event.publisher";
import { DynamoProcessedPaymentsRepository } from "./infrastructure/processed-payments.repository";

class InvocationCachedProductRepository
  implements ProductRepositoryPorts.ProductRepository
{
  private readonly cachedItems = new Map<string, Record<string, any>>();

  constructor(
    private readonly inner: ProductRepositoryPorts.ProductRepository,
  ) {}

  async create(product: Product): Promise<void> {
    await this.inner.create(product);
    this.cachedItems.set(product.productId, this.toCachedItem(product));
  }

  async update(product: Product): Promise<void> {
    await this.inner.update(product);
    this.cachedItems.set(product.productId, this.toCachedItem(product));
  }

  async delete(productId: string): Promise<void> {
    await this.inner.delete(productId);
    this.cachedItems.delete(productId);
  }

  async findById(productId: string): Promise<Product | null> {
    const cachedItem = this.cachedItems.get(productId);
    if (cachedItem) {
      return ProductMapper.toDomain(this.cloneItem(cachedItem));
    }

    const product = await this.inner.findById(productId);
    if (!product) {
      return null;
    }

    const item = this.toCachedItem(product);
    this.cachedItems.set(productId, item);
    return ProductMapper.toDomain(this.cloneItem(item));
  }

  async list(
    filters: ProductRepositoryPorts.ProductListFilters,
    pagination: ProductRepositoryPorts.Pagination,
  ): Promise<ProductRepositoryPorts.PaginatedResult<Product>> {
    return this.inner.list(filters, pagination);
  }

  private toCachedItem(product: Product): Record<string, any> {
    return this.cloneItem(ProductMapper.toItem(product));
  }

  private cloneItem(item: Record<string, any>): Record<string, any> {
    return JSON.parse(JSON.stringify(item));
  }
}

export function bootstrap() {
  const productsTableName = process.env.PRODUCTS_TABLE;
  const entitlementsTableName = process.env.ENTITLEMENTS_TABLE;
  const processedEventsTableName = process.env.PROCESSED_EVENTS_TABLE;
  const dunningTableName = process.env.DUNNING_TABLE; // Optional

  if (!productsTableName) {
    throw new Error("PRODUCTS_TABLE environment variable is not set");
  }
  if (!entitlementsTableName) {
    throw new Error("ENTITLEMENTS_TABLE environment variable is not set");
  }
  if (!processedEventsTableName) {
    throw new Error("PROCESSED_EVENTS_TABLE environment variable is not set");
  }

  const productRepo = new InvocationCachedProductRepository(
    new DynamoProductRepository(),
  );
  const entitlementRepo = new DynamoEntitlementRepository(entitlementsTableName);
  const createEntitlementUseCase = new CreateEntitlementUseCase(entitlementRepo);
  const eventPublisher = new EntitlementEventPublisher();
  const entitlementUpdateNotifier: EntitlementUpdateNotifier = {
    notify: (e) => eventPublisher.publishAvailabilityFromEntitlement(e),
  };
  const syncProductLimitsUseCase = new SyncProductLimitsToEntitlementsUseCase(
    productRepo,
    entitlementRepo,
    entitlementUpdateNotifier
  );
  const processedPaymentsRepo = new DynamoProcessedPaymentsRepository(processedEventsTableName);

  // Dunning repository is optional - only used to check state before revoking
  const dunningRepo = dunningTableName ? new DynamoDunningRepository(dunningTableName) : undefined;

  const processBillingEventUseCase = new ProcessBillingEventUseCase(
    createEntitlementUseCase,
    syncProductLimitsUseCase,
    eventPublisher,
    entitlementRepo,
    productRepo as ProductRepositoryPorts.ProductRepository,
    dunningRepo,
    processedPaymentsRepo
  );

  return {
    processBillingEventUseCase
  };
}
