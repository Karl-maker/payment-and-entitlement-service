import {
  DynamoEntitlementRepository,
  DynamoPriceRepository,
  DynamoProductRepository,
  ProductRepositoryPorts,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { ChargeTokenUseCase } from "./app/usecases/charge.token.usecase";
import { ChargeTokenController } from "./app/controllers/charge.token.controller";
import { EntitlementUpdatesPublisher } from "./infrastructure/entitlement-updates.publisher";
import { DynamoProcessedTokenChargesRepository } from "./infrastructure/processed-token-charges.repository";

export function bootstrap() {
  const entitlementsTableName = process.env.ENTITLEMENTS_TABLE;
  const pricesTableName = process.env.PRICES_TABLE;
  const productsTableName = process.env.PRODUCTS_TABLE;
  const processedEventsTableName = process.env.PROCESSED_EVENTS_TABLE;

  if (!entitlementsTableName) {
    throw new Error("ENTITLEMENTS_TABLE environment variable is not set");
  }
  if (!pricesTableName) {
    throw new Error("PRICES_TABLE environment variable is not set");
  }
  if (!productsTableName) {
    throw new Error("PRODUCTS_TABLE environment variable is not set");
  }
  if (!processedEventsTableName) {
    throw new Error("PROCESSED_EVENTS_TABLE environment variable is not set");
  }

  const entitlementRepo = new DynamoEntitlementRepository(
    entitlementsTableName,
  );
  const priceRepo = new DynamoPriceRepository();
  const productRepo = new DynamoProductRepository();
  const createEntitlementUseCase = new CreateEntitlementUseCase(
    entitlementRepo,
  );
  const entitlementUpdatesPublisher = new EntitlementUpdatesPublisher();
  const entitlementUpdateNotifier: EntitlementUpdateNotifier = {
    notify: (e) => entitlementUpdatesPublisher.publishFromEntitlement(e),
  };
  const syncProductLimitsUseCase = new SyncProductLimitsToEntitlementsUseCase(
    productRepo,
    entitlementRepo,
    entitlementUpdateNotifier,
  );
  const processedTokenChargesRepo = new DynamoProcessedTokenChargesRepository(
    processedEventsTableName,
  );

  const chargeTokenUseCase = new ChargeTokenUseCase(
    entitlementRepo,
    priceRepo,
    productRepo as ProductRepositoryPorts.ProductRepository,
    createEntitlementUseCase,
    syncProductLimitsUseCase,
    entitlementUpdateNotifier,
    processedTokenChargesRepo,
  );

  return {
    chargeTokenController: new ChargeTokenController(chargeTokenUseCase),
  };
}
