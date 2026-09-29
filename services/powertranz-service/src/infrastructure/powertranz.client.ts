import config from "../config";

type FetchLike = typeof fetch;

interface PaymentResponse {
  SpiToken?: string;
  spiToken?: string;
  RedirectData?: unknown;
  Html?: unknown;
  HTML?: unknown;
  HostedPageHtml?: unknown;
  TransactionIdentifier?: string;
  OrderIdentifier?: string;
}

export class PowerTranzClient {
  constructor(
    private readonly baseUrl: string = config.powertranz.baseUrl,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly merchantId: string = config.powertranz.merchantId,
    private readonly merchantPassword: string = config.powertranz.merchantPassword,
  ) {}

  private redactString(value: string): string {
    return value.replace(/([?&]secret=)[^&]+/gi, "$1[REDACTED]");
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map(item => this.redactValue(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
          if (/password|secret/i.test(key)) {
            return [key, "[REDACTED]"];
          }
          return [key, this.redactValue(entryValue)];
        }),
      );
    }

    return value;
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => {
        if (/password|secret|authorization/i.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, value];
      }),
    );
  }

  private logRequest(
    operation: string,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
  ): void {
    console.info("[PowerTranzClient] request", {
      operation,
      url,
      method,
      headers: this.sanitizeHeaders(headers),
      body: this.redactValue(body),
    });
  }

  private logResponse(
    operation: string,
    url: string,
    status: number | undefined,
    ok: boolean | undefined,
    body: unknown,
  ): void {
    console.info("[PowerTranzClient] response", {
      operation,
      url,
      status,
      ok,
      body: this.redactValue(body),
    });
  }

  private async postJson(
    path: string,
    operation: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const url = this.url(path);
    this.logRequest(operation, url, "POST", headers, body);

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const raw = await res.json().catch(() => null);
    this.logResponse(operation, url, res.status, res.ok, raw);

    if (!res.ok) {
      throw new Error(`PowerTranz ${operation} failed: ${res.status}`);
    }

    return raw;
  }

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    if (!base) {
      throw new Error("POWERTRANZ_BASE_URL is not configured");
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private jsonHeaders(includeMerchantAuth = true): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (!includeMerchantAuth) {
      return headers;
    }

    if (this.merchantId) {
      headers["PowerTranz-PowerTranzId"] = this.merchantId;
    }

    if (this.merchantPassword) {
      headers["PowerTranz-PowerTranzPassword"] =
        this.merchantPassword;
    }

    return headers;
  }

  async createAuthSpiToken(payload: Record<string, unknown>): Promise<{
    spiToken: string;
    redirectData?: unknown;
    hostedPaymentPageHtml?: string;
    transactionIdentifier?: string;
    orderIdentifier?: string;
  }> {
    const raw = (await this.postJson(
      "/Api/spi/Auth",
      "auth",
      payload,
      this.jsonHeaders(true),
    )) as { IsoResponseCode?: string; ResponseMessage?: string } | null;

    const response = raw as PaymentResponse;
    const iso = String(
      (raw as { IsoResponseCode?: string } | null)?.IsoResponseCode ?? "",
    ).trim();

    if (iso && iso !== "SP4") {
      throw new Error(
        `PowerTranz auth response not approved: ${iso} ${String(
          (raw as { ResponseMessage?: string } | null)?.ResponseMessage ?? "",
        ).trim()}`.trim(),
      );
    }

    const spiToken = String(response.SpiToken ?? response.spiToken ?? "").trim();
    if (!spiToken) {
      throw new Error("PowerTranz auth response missing SpiToken");
    }

    const hostedPaymentPageHtml = String(
      response.RedirectData ??
        response.Html ??
        response.HTML ??
        response.HostedPageHtml ??
        "",
    ).trim();

    return {
      spiToken,
      redirectData: response.RedirectData,
      ...(hostedPaymentPageHtml ? { hostedPaymentPageHtml } : {}),
      transactionIdentifier: response.TransactionIdentifier,
      orderIdentifier: response.OrderIdentifier,
    };
  }

  async chargePayment(spiToken: string): Promise<unknown> {
    return this.postJson(
      "/api/spi/payment",
      "payment",
      spiToken,
      this.jsonHeaders(true),
    );
  }

  async capturePayment(body: Record<string, unknown>): Promise<unknown> {
    return this.postJson(
      "/api/capture",
      "capture",
      body,
      this.jsonHeaders(true),
    );
  }
}
