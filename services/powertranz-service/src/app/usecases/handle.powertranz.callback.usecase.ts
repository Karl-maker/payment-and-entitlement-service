import { BillingEvent, Transaction, TransactionRepository } from "@libs/domain";
import config from "../../config";
import { PowerTranzIntentRepository } from "../../infrastructure/powertranz.intent.repository";
import { PowerTranzClient } from "../../infrastructure/powertranz.client";
import {
  PowerTranzBillingEventPublisher,
  PowerTranzEmailQueue,
} from "../../infrastructure/powertranz.callback.effects";
import { randomUUID } from "node:crypto";

const POWERTRANZ_CURRENCY_CODE = "780";

export interface HandlePowerTranzCallbackInput {
  spiToken: string;
  rawPayload: Record<string, unknown>;
}

export interface HandlePowerTranzCallbackOutput {
  status: "success" | "cancel";
  spiToken: string;
  transactionId?: string;
  orderIdentifier?: string;
}

export class HandlePowerTranzCallbackUseCase {
  constructor(
    private readonly powerTranzClient: PowerTranzClient,
    private readonly paymentIntentRepo: PowerTranzIntentRepository,
    private readonly emailQueue: PowerTranzEmailQueue,
    private readonly billingEventPublisher: PowerTranzBillingEventPublisher,
    private readonly transactionRepo: TransactionRepository,
  ) {}

  private stringValue(value: unknown): string | undefined {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private detailsPatch(source: Record<string, unknown>, at: string) {
    const errors = Array.isArray(source.Errors)
      ? (source.Errors as Array<Record<string, unknown>>)
      : [];
    const firstError = errors[0];

    return {
      lastCallbackAt: at,
      transactionId: this.stringValue(source.TransactionIdentifier),
      orderIdentifier: this.stringValue(source.OrderIdentifier),
      approved:
        typeof source.Approved === "boolean"
          ? (source.Approved as boolean)
          : undefined,
      isoResponseCode: this.stringValue(source.IsoResponseCode),
      responseMessage: this.stringValue(source.ResponseMessage),
      cardBrand: this.stringValue(source.CardBrand),
      transactionType: this.numberValue(source.TransactionType),
      lastErrorCode: this.stringValue(firstError?.Code),
      lastErrorMessage: this.stringValue(firstError?.Message),
    };
  }

  async execute(
    input: HandlePowerTranzCallbackInput,
  ): Promise<HandlePowerTranzCallbackOutput> {
    console.info("[HandlePowerTranzCallbackUseCase] start", {
      spiTokenPrefix: input.spiToken.slice(0, 12),
    });

    const intent = await this.paymentIntentRepo.findBySpiToken(input.spiToken);

    if (!intent) {
      console.warn("[HandlePowerTranzCallbackUseCase] intent not found", {
        spiTokenPrefix: input.spiToken.slice(0, 12),
      });
      return { status: "cancel", spiToken: input.spiToken };
    }

    console.info("[HandlePowerTranzCallbackUseCase] intent loaded", {
      spiTokenPrefix: intent.spiToken.slice(0, 12),
      intentId: intent.id,
      status: intent.status,
      priceId: intent.priceId,
      productId: intent.productId,
    });

    if (intent.status === "completed") {
      // idempotency check - if we've already processed this callback, do nothing
      return {
        status: "success",
        spiToken: intent.spiToken,
        transactionId: intent.transactionId,
        orderIdentifier: intent.orderIdentifier,
      };
    }

    if (intent.status === "failed") {
      return {
        status: "cancel",
        spiToken: intent.spiToken,
        transactionId: intent.transactionId,
        orderIdentifier: intent.orderIdentifier,
      };
    }

    const riskManagement = input.rawPayload.RiskManagement as
      | Record<string, unknown>
      | undefined;

    const threeDSecure = riskManagement?.["ThreeDSecure"] as
      | Record<string, unknown>
      | undefined;

    const authStatus = String(
      input.rawPayload.AuthenticationStatus ??
        threeDSecure?.AuthenticationStatus ??
        "",
    )
      .trim()
      .toUpperCase();

    const authIso = String(
      input.rawPayload.IsoResponseCode ?? threeDSecure?.ResponseCode ?? "",
    )
      .trim()
      .toUpperCase();

    const hasThreeDsSignal = authStatus.length > 0 || authIso.length > 0;
    const hostedPagePreprocessingComplete = authIso === "HP0";
    const threeDsApproved = authStatus === "Y" && authIso === "3D0";
    const threeDsUnsupported = authIso === "3D1";
    const canProceedToPayment =
      hostedPagePreprocessingComplete ||
      threeDsApproved ||
      (threeDsUnsupported && config.powertranz.allowNonThreeDsFallback);
    const callbackAt = new Date().toISOString();

    console.info("[HandlePowerTranzCallbackUseCase] callback auth state", {
      intentId: intent.id,
      authStatus,
      authIso,
      hasThreeDsSignal,
      hostedPagePreprocessingComplete,
      threeDsApproved,
      threeDsUnsupported,
      canProceedToPayment,
    });

    if (hasThreeDsSignal && !canProceedToPayment) {
      await this.paymentIntentRepo.updateBySpiToken(intent.spiToken, {
        ...this.detailsPatch(input.rawPayload, callbackAt),
        status: "failed",
        failedAt: callbackAt,
        approved: false,
        responseMessage:
          this.stringValue(input.rawPayload.ResponseMessage) ??
          "3DS authentication was not completed",
      });

      if (intent.userEmail) {
        await this.emailQueue.send({
          template: "payment-failed.hbs",
          header: "Payment failed",
          to: intent.userEmail,
          content: {
            amount: intent.amount,
            currency: intent.currency,
            priceId: intent.priceId,
            productId: intent.productId,
            failureReason: "3DS authentication was not completed",
          },
        });
      }

      return {
        status: "cancel",
        spiToken: intent.spiToken,
        transactionId:
          this.stringValue(input.rawPayload.TransactionIdentifier) ??
          intent.transactionId,
        orderIdentifier:
          this.stringValue(input.rawPayload.OrderIdentifier) ??
          intent.orderIdentifier,
      };
    }

    let paymentResult: unknown;

    try {
      // The browser return only proves the hosted-page / 3DS flow finished.
      // We still need to complete the SPI payment server-side.
      paymentResult = await this.powerTranzClient.chargePayment(input.spiToken);
      console.info("[HandlePowerTranzCallbackUseCase] spi payment response", {
        intentId: intent.id,
        isoResponseCode: String(
          (paymentResult as { IsoResponseCode?: string }).IsoResponseCode ?? "",
        ).trim(),
        responseMessage: String(
          (paymentResult as { ResponseMessage?: string }).ResponseMessage ?? "",
        ).trim(),
        approved: (paymentResult as { Approved?: unknown }).Approved,
        transactionIdentifier: String(
          (paymentResult as { TransactionIdentifier?: string })
            .TransactionIdentifier ?? "",
        ).trim(),
        orderIdentifier: String(
          (paymentResult as { OrderIdentifier?: string }).OrderIdentifier ?? "",
        ).trim(),
        transactionType: (paymentResult as { TransactionType?: unknown })
          .TransactionType,
      });
    } catch (error) {
      console.error("[HandlePowerTranzCallbackUseCase] spi payment request failed", {
        intentId: intent.id,
        message: error instanceof Error ? error.message : "PowerTranz failed",
      });
      await this.paymentIntentRepo.updateBySpiToken(intent.spiToken, {
        ...this.detailsPatch(input.rawPayload, callbackAt),
        status: "failed",
        failedAt: callbackAt,
        approved: false,
        responseMessage:
          error instanceof Error ? error.message : "PowerTranz failed",
      });

      if (intent.userEmail) {
        await this.emailQueue.send({
          template: "payment-failed.hbs",
          header: "Payment failed",
          to: intent.userEmail,
          content: {
            amount: intent.amount,
            currency: intent.currency,
            priceId: intent.priceId,
            productId: intent.productId,
            failureReason:
              error instanceof Error ? error.message : "PowerTranz failed",
          },
        });
      }

      return {
        status: "cancel",
        spiToken: intent.spiToken,
        transactionId:
          this.stringValue(input.rawPayload.TransactionIdentifier) ??
          intent.transactionId,
        orderIdentifier:
          this.stringValue(input.rawPayload.OrderIdentifier) ??
          intent.orderIdentifier,
      };
    }

    const iso = String(
      (paymentResult as { IsoResponseCode?: string }).IsoResponseCode ?? "",
    ); // checks if payment was approved, "00" means approved in PowerTranz
    const paymentDetails = this.detailsPatch(
      paymentResult as Record<string, unknown>,
      callbackAt,
    );

    if (iso !== "00") {
      console.warn("[HandlePowerTranzCallbackUseCase] spi payment not approved", {
        intentId: intent.id,
        isoResponseCode: iso,
        responseMessage: String(
          (paymentResult as { ResponseMessage?: string }).ResponseMessage ?? "",
        ).trim(),
      });
      await this.paymentIntentRepo.updateBySpiToken(intent.spiToken, {
        ...paymentDetails,
        status: "failed",
        failedAt: callbackAt,
        approved: false,
      });

      if (intent.userEmail) {
        await this.emailQueue.send({
          template: "payment-failed.hbs",
          header: "Payment failed",
          to: intent.userEmail,
          content: {
            amount: intent.amount,
            currency: intent.currency,
            priceId: intent.priceId,
            productId: intent.productId,
            failureCode: iso,
            failureReason: String(
              (paymentResult as { ResponseMessage?: string }).ResponseMessage ??
                "Payment failed",
            ),
          },
        });
      }

      return {
        status: "cancel",
        spiToken: intent.spiToken,
        transactionId: paymentDetails.transactionId ?? intent.transactionId,
        orderIdentifier: paymentDetails.orderIdentifier ?? intent.orderIdentifier,
      };
    }

    const transactionId =
      String(
        (paymentResult as { TransactionIdentifier?: string })
          .TransactionIdentifier ?? "",
      ).trim() || input.spiToken;

    const captureResult = await this.powerTranzClient.capturePayment({
      TransactionIdentifier: transactionId,
      TotalAmount: Number(
        (paymentResult as { TotalAmount?: number }).TotalAmount ?? intent.amount,
      ),
      CurrencyCode: POWERTRANZ_CURRENCY_CODE,
    });

    const captureIso = String(
      (captureResult as { IsoResponseCode?: string }).IsoResponseCode ?? "",
    ).trim();
    const captureDetails = this.detailsPatch(
      captureResult as Record<string, unknown>,
      callbackAt,
    );

    console.info("[HandlePowerTranzCallbackUseCase] capture response", {
      intentId: intent.id,
      transactionId,
      isoResponseCode: captureIso,
      responseMessage: String(
        (captureResult as { ResponseMessage?: string }).ResponseMessage ?? "",
      ).trim(),
      approved: (captureResult as { Approved?: unknown }).Approved,
      orderIdentifier: String(
        (captureResult as { OrderIdentifier?: string }).OrderIdentifier ?? "",
      ).trim(),
      transactionType: (captureResult as { TransactionType?: unknown })
        .TransactionType,
    });

    if (captureIso !== "00") {
      console.warn("[HandlePowerTranzCallbackUseCase] capture not approved", {
        intentId: intent.id,
        transactionId,
        isoResponseCode: captureIso,
        responseMessage: String(
          (captureResult as { ResponseMessage?: string }).ResponseMessage ?? "",
        ).trim(),
      });
      await this.paymentIntentRepo.updateBySpiToken(intent.spiToken, {
        ...captureDetails,
        status: "failed",
        failedAt: callbackAt,
        approved: false,
      });

      if (intent.userEmail) {
        await this.emailQueue.send({
          template: "payment-failed.hbs",
          header: "Payment failed",
          to: intent.userEmail,
          content: {
            amount: intent.amount,
            currency: intent.currency,
            priceId: intent.priceId,
            productId: intent.productId,
            failureCode: captureIso,
            failureReason: String(
              (captureResult as { ResponseMessage?: string }).ResponseMessage ??
                "Capture failed",
            ),
          },
        });
      }

      return {
        status: "cancel",
        spiToken: intent.spiToken,
        transactionId: captureDetails.transactionId ?? transactionId,
        orderIdentifier: captureDetails.orderIdentifier ?? intent.orderIdentifier,
      };
    }

    await this.paymentIntentRepo.updateBySpiToken(intent.spiToken, {
      ...captureDetails,
      status: "completed",
      paidAt: callbackAt,
      approved: true,
      transactionId,
    });

    console.info("[HandlePowerTranzCallbackUseCase] payment completed", {
      intentId: intent.id,
      transactionId,
      orderIdentifier: captureDetails.orderIdentifier ?? intent.orderIdentifier,
    });

    const billingEvent: BillingEvent.PaymentSuccessfulEvent = {
      type: BillingEvent.PaymentEventType.PAYMENT_SUCCESSFUL,
      version: 1,
      meta: {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        source: "powertranz",
      },
      payload: {
        paymentIntentId: intent.id,
        userId: intent.userId,
        amount: intent.amount,
        currency: intent.currency,
        priceId: intent.priceId,
        productId: intent.productId,
        provider: "powertranz",
        billingType: "one_time",
      },
    };

    const transaction = new Transaction(
      intent.id,
      intent.userId,
      "payment.successful",
      "success",
      intent.amount,
      intent.currency,
      new Date(intent.createdAt),
      intent.productId,
      intent.priceId,
      undefined,
      "powertranz",
      {
        eventId: billingEvent.meta.eventId,
        provider: "powertranz",
        billingType: "one_time",
      },
    );

    await this.transactionRepo.save(transaction);
    await this.billingEventPublisher.publish(billingEvent);

    if (intent.userEmail) {
      await this.emailQueue.send({
        template: "payment-successful.hbs",
        header: "Payment successful",
        to: intent.userEmail,
        content: {
          amount: intent.amount,
          currency: intent.currency,
          priceId: intent.priceId,
          productId: intent.productId,
          transactionId: transaction.transactionId,
        },
      });
    }

    return {
      status: "success",
      spiToken: intent.spiToken,
      transactionId: captureDetails.transactionId ?? transactionId,
      orderIdentifier: captureDetails.orderIdentifier ?? intent.orderIdentifier,
    };
  }
}
