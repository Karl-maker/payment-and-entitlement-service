import { RequestContext } from "../../handler/api-gateway/types";
import config from "../../config";
import { HandlePowerTranzCallbackUseCase } from "../usecases/handle.powertranz.callback.usecase";
import { redirect } from "../../handler/api-gateway/response";

export class PowerTranzCallbackController {
  // for accepting the powertranz callback payload and then sends it to the usecase
  constructor(private readonly useCase: HandlePowerTranzCallbackUseCase) {}

  private billingRedirect(
    payment: "success" | "cancel",
    details?: {
      spiToken?: string;
      transactionId?: string;
      orderIdentifier?: string;
    },
  ) {
    const url = new URL(
      "/billing",
      config.powertranz.billingRedirectBaseUrl,
    );
    url.searchParams.set("payment", payment);

    if (details?.spiToken) {
      url.searchParams.set("spiToken", details.spiToken);
    }

    if (details?.transactionId) {
      url.searchParams.set("transactionIdentifier", details.transactionId);
    }

    if (details?.orderIdentifier) {
      url.searchParams.set("orderIdentifier", details.orderIdentifier);
    }

    return redirect(url.toString());
  }

  private callbackPayload(body: Record<string, unknown>): Record<string, unknown> {
    const responseRaw = body.Response;
    if (typeof responseRaw !== "string" || !responseRaw.trim()) {
      return body;
    }

    try {
      const parsed = JSON.parse(responseRaw) as Record<string, unknown>;
      return {
        ...parsed,
        ...body,
        SpiToken: body.SpiToken ?? parsed.SpiToken,
      };
    } catch {
      throw new Error("Invalid callback payload: Response is not valid JSON");
    }
  }

  handle = async (req: RequestContext) => {
    const headerSecret = req.headers?.["x-powertranz-callback-secret"];
    const querySecret = req.query?.secret;

    console.info("[PowerTranzCallbackController] callback received", {
      method: req.method,
      path: req.path,
      hasHeaderSecret: Boolean(headerSecret),
      hasQuerySecret: Boolean(querySecret),
      queryKeys: Object.keys(req.query ?? {}),
      bodyType: typeof req.body,
    });

    if (
      config.powertranz.callbackSecret &&
      headerSecret !== config.powertranz.callbackSecret &&
      querySecret !== config.powertranz.callbackSecret
    ) {
      console.warn("[PowerTranzCallbackController] callback secret mismatch");
      return this.billingRedirect("cancel");
    }

    const queryPayload = { ...(req.query ?? {}) };
    delete queryPayload.secret;

    const bodyPayload =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};

    const rawPayload = {
      ...queryPayload,
      ...bodyPayload,
    };

    if (Object.keys(rawPayload).length === 0) {
      return this.billingRedirect("cancel");
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.callbackPayload(rawPayload);
    } catch {
      console.warn("[PowerTranzCallbackController] invalid callback payload");
      return this.billingRedirect("cancel");
    }

    const spiToken = String(
      payload.SpiToken || payload.spiToken || "",
    ).trim();
    if (!spiToken) {
      console.warn("[PowerTranzCallbackController] missing SpiToken");
      return this.billingRedirect("cancel");
    }

    console.info("[PowerTranzCallbackController] callback parsed", {
      spiTokenPrefix: spiToken.slice(0, 12),
      transactionIdentifier: String(payload.TransactionIdentifier ?? "").trim(),
      orderIdentifier: String(payload.OrderIdentifier ?? "").trim(),
      isoResponseCode: String(payload.IsoResponseCode ?? "").trim(),
      responseMessage: String(payload.ResponseMessage ?? "").trim(),
      transactionType: payload.TransactionType,
    });

    try {
      const result = await this.useCase.execute({
        spiToken,
        rawPayload: payload,
      });

      console.info("[PowerTranzCallbackController] callback completed", {
        spiTokenPrefix: result.spiToken.slice(0, 12),
        status: result.status,
        transactionId: result.transactionId,
        orderIdentifier: result.orderIdentifier,
      });

      return this.billingRedirect(result.status, {
        spiToken: result.spiToken,
        transactionId: result.transactionId,
        orderIdentifier: result.orderIdentifier,
      });
    } catch {
      console.error("[PowerTranzCallbackController] callback failed unexpectedly", {
        spiTokenPrefix: spiToken.slice(0, 12),
      });
      return this.billingRedirect("cancel", {
        spiToken,
        transactionId: String(payload.TransactionIdentifier ?? "").trim() || undefined,
        orderIdentifier: String(payload.OrderIdentifier ?? "").trim() || undefined,
      });
    }
  };
}
