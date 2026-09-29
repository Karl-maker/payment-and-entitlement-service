import {
  GetPriceUseCase,
  GetProductUseCase,
  BillingType,
  ProductType,
} from "@libs/domain";
import config from "../../config";
import { PowerTranzClient } from "../../infrastructure/powertranz.client";
import {
  PowerTranzIntentRepository,
  PowerTranzPaymentIntent,
} from "../../infrastructure/powertranz.intent.repository";
import { randomUUID } from "crypto";
import { BadRequestError } from "../errors/bad-request.error";

const POWERTRANZ_CURRENCY = "TTD";
const USD_CURRENCY = "USD";
const POWERTRANZ_CURRENCY_CODE = "780";
const POWERTRANZ_3DS_CHALLENGE_WINDOW_SIZE = 4;
const POWERTRANZ_3DS_CHALLENGE_INDICATOR = "01";
export type PowerTranzCardType = "debit" | "credit";

export interface CreatePowerTranzPaymentIntentInput {
  userId: string;
  userEmail?: string;
  priceId: string;
  cardType?: PowerTranzCardType;
}

export interface CreatePowerTranzPaymentIntentOutput {
  redirectData?: unknown;
  hostedPaymentPageHtml?: string;
  spiToken: string;
  transactionIdentifier?: string;
  orderIdentifier?: string;
  expiresAt: string;
  amount: number;
  currency: string;
  priceId: string;
  productId: string;
}

export class CreatePaymentIntentUseCase {
  constructor(
    private readonly getPriceUseCase: GetPriceUseCase,
    private readonly getProductUseCase: GetProductUseCase,
    private readonly powerTranzClient: PowerTranzClient,
    private readonly paymentIntentRepo: PowerTranzIntentRepository,
  ) {}

  private merchantResponseUrl(): string {
    const baseUrl = config.powertranz.merchantResponseUrl.trim();
    if (!baseUrl) {
      throw new Error("POWERTRANZ_MERCHANT_RESPONSE_URL is not configured");
    }

    if (!config.powertranz.callbackSecret) {
      return baseUrl;
    }

    const url = new URL(baseUrl);
    url.searchParams.set("secret", config.powertranz.callbackSecret);
    return url.toString();
  }

  private hostedPagePageSet(): string | undefined {
    const pageSet = config.powertranz.hostedPagePageSet.trim();
    if (!pageSet) {
      return undefined;
    }

    return pageSet.startsWith("PTZ/") ? pageSet : `PTZ/${pageSet}`;
  }

  private powerTranzAmount(amount: number, currency: string): number {
    const normalizedCurrency = currency.trim().toUpperCase();
    if (normalizedCurrency === POWERTRANZ_CURRENCY) {
      return amount;
    }

    if (normalizedCurrency !== USD_CURRENCY) {
      throw new BadRequestError(
        `Unsupported PowerTranz source currency: ${currency}`,
      );
    }

    const exchangeRate = config.powertranz.usdTtdExchangeRate;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new Error("USD_TTD_EXCHANGE_RATE must be a positive number");
    }

    return Math.round(amount * exchangeRate * 100) / 100;
  }

  private shouldUseThreeDs(cardType?: PowerTranzCardType): boolean {
    const effectiveCardType: PowerTranzCardType = cardType ?? "credit";

    if (effectiveCardType === "debit") {
      return false;
    }

    return config.powertranz.threeDsEnabled;
  }

  async execute(
    input: CreatePowerTranzPaymentIntentInput,
  ): Promise<CreatePowerTranzPaymentIntentOutput> {
    const price = await this.getPriceUseCase.execute(input.priceId);
    const product = await this.getProductUseCase.execute(price.productId);

    if (price.billingType !== BillingType.ONE_TIME) {
      throw new BadRequestError("Only one time payments are supported for now");
    }

    if (product.type !== ProductType.ONE_OFF) {
      throw new BadRequestError("Must be a one time purchase product");
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const transactionIdentifier = randomUUID();
    const orderIdentifier = transactionIdentifier;
    const pageSet = this.hostedPagePageSet();
    const powerTranzAmount = this.powerTranzAmount(price.amount, price.currency);
    const threeDsEnabled = this.shouldUseThreeDs(input.cardType);

    const sale = await this.powerTranzClient.createAuthSpiToken({
      TransactionIdentifier: transactionIdentifier,
      TotalAmount: powerTranzAmount,
      CurrencyCode: POWERTRANZ_CURRENCY_CODE,
      ThreeDSecure: threeDsEnabled,
      OrderIdentifier: orderIdentifier,
      AddressMatch: false,
      ExtendedData: {
        MerchantResponseUrl: this.merchantResponseUrl(),
        ...(threeDsEnabled
          ? {
              ThreeDSecure: {
                ChallengeWindowSize: POWERTRANZ_3DS_CHALLENGE_WINDOW_SIZE,
                ChallengeIndicator: POWERTRANZ_3DS_CHALLENGE_INDICATOR,
              },
            }
          : {}),
        HostedPage: {
          ...(pageSet ? { PageSet: pageSet } : {}),
          ...(config.powertranz.hostedPagePageName
            ? { PageName: config.powertranz.hostedPagePageName }
            : {}),
        },
      },
    });

    const intent: PowerTranzPaymentIntent = {
      id: randomUUID(),
      userId: input.userId,
      userEmail: input.userEmail,
      priceId: input.priceId,
      productId: price.productId,
      spiToken: sale.spiToken,
      amount: powerTranzAmount,
      currency: POWERTRANZ_CURRENCY,
      status: "pending_payment",
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      transactionId: sale.transactionIdentifier || transactionIdentifier,
      orderIdentifier: sale.orderIdentifier || orderIdentifier,
    };

    await this.paymentIntentRepo.save(intent);

    return {
      redirectData: sale.redirectData,
      hostedPaymentPageHtml: sale.hostedPaymentPageHtml,
      spiToken: sale.spiToken,
      transactionIdentifier: intent.transactionId,
      orderIdentifier: intent.orderIdentifier,
      expiresAt: expiresAt.toISOString(),
      amount: powerTranzAmount,
      currency: POWERTRANZ_CURRENCY,
      priceId: input.priceId,
      productId: price.productId,
    };
  }
}
