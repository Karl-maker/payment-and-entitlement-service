import { HealthController } from "./app/controllers/health.controller";
import { CreatePaymentIntentController } from "./app/controllers/create.payment.intent.controller";
import { CreatePaymentIntentUseCase } from "./app/usecases/create.payment.intent.usecase";
import { PowerTranzClient } from "./infrastructure/powertranz.client";
import { DynamoPowerTranzIntentRepository } from "./infrastructure/dynamo.powertranz-intent.repository";
import { PowerTranzCallbackController } from "./app/controllers/powertranz.callback.controller";
import { HandlePowerTranzCallbackUseCase } from "./app/usecases/handle.powertranz.callback.usecase";
import { GetPowerTranzInvoicesController } from "./app/controllers/get.powertranz.invoices.controller";
import { GetPowerTranzInvoicesUseCase } from "./app/usecases/get.powertranz.invoices.usecase";
import { SqsEmailQueuePublisher } from "./infrastructure/email.queue.publisher";
import { BillingEventPublisher } from "./infrastructure/billing-event.publisher";
import {
  GetPriceUseCase,
  GetProductUseCase,
  DynamoPriceRepository,
  DynamoProductRepository,
  DynamoTransactionRepository,
} from "@libs/domain";

export function bootstrap() {
  const healthController = new HealthController();
  const priceRepo = new DynamoPriceRepository();
  const productRepo = new DynamoProductRepository();
  const transactionRepo = new DynamoTransactionRepository(
    process.env.TRANSACTIONS_TABLE || "",
  );

  const getPriceUseCase = new GetPriceUseCase(priceRepo);
  const getProductUseCase = new GetProductUseCase(productRepo);

  const powerTranzClient = new PowerTranzClient();
  const paymentIntentRepo = new DynamoPowerTranzIntentRepository();

  const billingEventPublisher = new BillingEventPublisher();
  const emailQueue = new SqsEmailQueuePublisher();

  const createPaymentIntentUseCase = new CreatePaymentIntentUseCase(
    getPriceUseCase,
    getProductUseCase,
    powerTranzClient,
    paymentIntentRepo,
  );

  const handlePowerTranzCallbackUseCase = new HandlePowerTranzCallbackUseCase(
    powerTranzClient,
    paymentIntentRepo,
    emailQueue,
    billingEventPublisher,
    transactionRepo,
  );

  const createPaymentIntentController = new CreatePaymentIntentController(
    createPaymentIntentUseCase,
  );
  const getPowerTranzInvoicesUseCase = new GetPowerTranzInvoicesUseCase(
    paymentIntentRepo,
  );
  const getPowerTranzInvoicesController = new GetPowerTranzInvoicesController(
    getPowerTranzInvoicesUseCase,
  );
  const powerTranzCallbackController = new PowerTranzCallbackController(
    handlePowerTranzCallbackUseCase,
  );

  return {
    healthController,
    createPaymentIntentController,
    getPowerTranzInvoicesController,
    powerTranzCallbackController,
  };
}
