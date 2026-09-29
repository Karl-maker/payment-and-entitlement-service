import { PowerTranzCallbackController } from "../../../services/powertranz-service/src/app/controllers/powertranz.callback.controller";
import config from "../../../services/powertranz-service/src/config";

describe("PowerTranzCallbackController", () => {
  function callbackQuery(query: Record<string, string> = {}) {
    return {
      ...(config.powertranz.callbackSecret
        ? { secret: config.powertranz.callbackSecret }
        : {}),
      ...query,
    };
  }

  function buildController() {
    const useCase = {
      execute: jest
        .fn()
        .mockResolvedValue({ status: "success", spiToken: "spi_123" }),
    };

    return {
      controller: new PowerTranzCallbackController(useCase as any),
      useCase,
    };
  }

  it("unwraps PowerTranz Response JSON and processes the nested SpiToken", async () => {
    const { controller, useCase } = buildController();

    const result = await controller.handle({
      method: "POST",
      path: "/powertranz/callback",
      pathParams: {},
      query: callbackQuery(),
      headers: {},
      body: {
        Response: JSON.stringify({
          SpiToken: "spi_123",
          AuthenticationStatus: "Y",
          IsoResponseCode: "3D0",
        }),
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 303,
        headers: expect.objectContaining({
          Location:
            "https://development.is-ed.com/billing?payment=success&spiToken=spi_123",
        }),
        body: "",
      }),
    );
    expect(useCase.execute).toHaveBeenCalledWith({
      spiToken: "spi_123",
      rawPayload: expect.objectContaining({
        SpiToken: "spi_123",
        AuthenticationStatus: "Y",
        IsoResponseCode: "3D0",
      }),
    });
  });

  it("accepts PowerTranz callback payload from query parameters", async () => {
    const { controller, useCase } = buildController();
    useCase.execute.mockResolvedValue({
      status: "success",
      spiToken: "spi_query_123",
    });

    const result = await controller.handle({
      method: "GET",
      path: "/powertranz/callback",
      pathParams: {},
      query: callbackQuery({
        Response: JSON.stringify({
          SpiToken: "spi_query_123",
          AuthenticationStatus: "Y",
          IsoResponseCode: "3D0",
        }),
      }),
      headers: {},
      body: null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 303,
        headers: expect.objectContaining({
          Location:
            "https://development.is-ed.com/billing?payment=success&spiToken=spi_query_123",
        }),
        body: "",
      }),
    );
    expect(useCase.execute).toHaveBeenCalledWith({
      spiToken: "spi_query_123",
      rawPayload: expect.objectContaining({
        SpiToken: "spi_query_123",
        AuthenticationStatus: "Y",
        IsoResponseCode: "3D0",
      }),
    });
  });

  it("redirects to cancel for an invalid Response JSON wrapper", async () => {
    const { controller, useCase } = buildController();

    const result = await controller.handle({
      method: "POST",
      path: "/powertranz/callback",
      pathParams: {},
      query: callbackQuery(),
      headers: {},
      body: {
        Response: "{not-json",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 303,
        headers: expect.objectContaining({
          Location: "https://development.is-ed.com/billing?payment=cancel",
        }),
        body: "",
      }),
    );

    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it("redirects to cancel when callback processing fails", async () => {
    const { controller, useCase } = buildController();
    useCase.execute.mockResolvedValue({ status: "cancel", spiToken: "spi_123" });

    const result = await controller.handle({
      method: "POST",
      path: "/powertranz/callback",
      pathParams: {},
      query: callbackQuery(),
      headers: {},
      body: {
        SpiToken: "spi_123",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 303,
        headers: expect.objectContaining({
          Location:
            "https://development.is-ed.com/billing?payment=cancel&spiToken=spi_123",
        }),
        body: "",
      }),
    );
  });
});
