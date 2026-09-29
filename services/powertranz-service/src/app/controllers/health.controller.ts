import { RequestContext } from "../../handler/api-gateway/types";

export class HealthController {
  async handle(req: RequestContext): Promise<{ ok: boolean; service: string; timestamp: string }> {
    if (req.query.forceError === "true") {
      const error = new Error("Powertranz forced error");
      error.name = "ValidationError";
      throw error;
    }

    if (req.query.forceError === "500") {
      throw new Error("Powertranz unexpected error");
    }

    return {
      ok: true,
      service: "powertranz",
      timestamp: new Date().toISOString(),
    };
  }
}
