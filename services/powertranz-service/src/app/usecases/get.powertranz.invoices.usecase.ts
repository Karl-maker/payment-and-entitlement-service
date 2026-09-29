import {
  PowerTranzIntentRepository,
  PowerTranzPaymentIntent,
  PowerTranzIntentStatus,
} from "../../infrastructure/powertranz.intent.repository";

export interface GetPowerTranzInvoicesInput {
  userId: string;
  limit?: number;
  status?: PowerTranzIntentStatus;
  spiToken?: string;
  transactionIdentifier?: string;
  orderIdentifier?: string;
}

export class GetPowerTranzInvoicesUseCase {
  constructor(
    private readonly paymentIntentRepo: PowerTranzIntentRepository,
  ) {}

  async execute(
    input: GetPowerTranzInvoicesInput,
  ): Promise<PowerTranzPaymentIntent[]> {
    const invoices = await this.paymentIntentRepo.findByUserId(input.userId);

    const filtered = invoices.filter((invoice) => {
      if (input.status && invoice.status !== input.status) {
        return false;
      }

      if (input.spiToken && invoice.spiToken !== input.spiToken) {
        return false;
      }

      if (
        input.transactionIdentifier &&
        invoice.transactionId !== input.transactionIdentifier
      ) {
        return false;
      }

      if (
        input.orderIdentifier &&
        invoice.orderIdentifier !== input.orderIdentifier
      ) {
        return false;
      }

      return true;
    });

    return typeof input.limit === "number"
      ? filtered.slice(0, input.limit)
      : filtered;
  }
}
