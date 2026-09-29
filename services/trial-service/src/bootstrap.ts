import {
  DynamoTrialRepository,
  DynamoProductRepository,
  DynamoEntitlementRepository,
  CreateEntitlementUseCase,
  SyncProductLimitsToEntitlementsUseCase,
  ProductRepositoryPorts,
  type EntitlementUpdateNotifier,
} from "@libs/domain";
import { StartTrialUseCase } from "./app/usecases/start.trial.usecase";
import { StartTrialController } from "./app/controllers/start.trial.controller";
import { CheckTrialStatusUseCase } from "./app/usecases/check.trial.status.usecase";
import { CheckTrialStatusController } from "./app/controllers/check.trial.status.controller";
import { EntitlementUpdatesPublisher } from "./infrastructure/entitlement-updates.publisher";

export function bootstrap() {
  const trialsTableName = process.env.TRIALS_TABLE;
  const productsTableName = process.env.PRODUCTS_TABLE;
  const entitlementsTableName = process.env.ENTITLEMENTS_TABLE;

  if (!trialsTableName) {
    throw new Error("TRIALS_TABLE environment variable is not set");
  }
  if (!productsTableName) {
    throw new Error("PRODUCTS_TABLE environment variable is not set");
  }
  if (!entitlementsTableName) {
    throw new Error("ENTITLEMENTS_TABLE environment variable is not set");
  }

  const trialRepo = new DynamoTrialRepository(trialsTableName);
  const productRepo = new DynamoProductRepository();
  const entitlementRepo = new DynamoEntitlementRepository(entitlementsTableName);
  const createEntitlementUseCase = new CreateEntitlementUseCase(entitlementRepo);
  const entitlementUpdatesPublisher = new EntitlementUpdatesPublisher();
  const entitlementUpdateNotifier: EntitlementUpdateNotifier = {
    notify: (e) => entitlementUpdatesPublisher.publishFromEntitlement(e),
  };
  const syncProductLimitsUseCase = new SyncProductLimitsToEntitlementsUseCase(
    productRepo,
    entitlementRepo,
    entitlementUpdateNotifier
  );

  const startTrialUseCase = new StartTrialUseCase(
    trialRepo,
    productRepo as ProductRepositoryPorts.ProductRepository,
    entitlementRepo,
    createEntitlementUseCase,
    syncProductLimitsUseCase,
    entitlementUpdateNotifier
  );

  const checkTrialStatusUseCase = new CheckTrialStatusUseCase(trialRepo);

  return {
    startTrialController: new StartTrialController(startTrialUseCase),
    checkTrialStatusController: new CheckTrialStatusController(checkTrialStatusUseCase)
  };
}
