import { createApiGatewayEvent } from "../helpers/fixtures";

let handler: (typeof import("../../services/powertranz-service/src/handler/index"))["handler"];

describe("Powertranz Service Smoke Test", () => {
  beforeAll(async () => {
    const mod = await import("../../services/powertranz-service/src/handler/index");
    handler = mod.handler;
  });

  it("returns 200 for the health route", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "GET",
      path: "/powertranz/health",
      resource: "/powertranz/health",
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("powertranz");
  });

  it("returns 404 for an unknown route", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "GET",
      path: "/powertranz/unknown",
      resource: "/powertranz/unknown",
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Route not found");
  });

  it("returns 400 when the controller raises a validation error", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "GET",
      path: "/powertranz/health",
      resource: "/powertranz/health",
      queryStringParameters: {
        forceError: "true",
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("BAD_REQUEST");
  });

  it("returns 500 when the controller raises an unexpected error", async () => {
    const event = createApiGatewayEvent({
      httpMethod: "GET",
      path: "/powertranz/health",
      resource: "/powertranz/health",
      queryStringParameters: {
        forceError: "500",
      },
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("INTERNAL_SERVER_ERROR");
  });
});
