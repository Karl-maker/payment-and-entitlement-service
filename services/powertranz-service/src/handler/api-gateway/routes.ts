import { bootstrap } from "../../bootstrap";
import { RequestContext } from "./types";

const {
  healthController,
  createPaymentIntentController,
  getPowerTranzInvoicesController,
  powerTranzCallbackController,
} = bootstrap();

export const routes: Record<string, (req: RequestContext) => Promise<any>> = {
  "GET /powertranz/health": healthController.handle.bind(healthController),
  "POST /powertranz/payment-intents": createPaymentIntentController.handle.bind(
    createPaymentIntentController,
  ),
  "GET /powertranz/invoices": getPowerTranzInvoicesController.handle.bind(
    getPowerTranzInvoicesController,
  ),
  "POST /powertranz/callback": powerTranzCallbackController.handle.bind(
    powerTranzCallbackController,
  ),
  "GET /powertranz/callback": powerTranzCallbackController.handle.bind(
    powerTranzCallbackController,
  ),
};
