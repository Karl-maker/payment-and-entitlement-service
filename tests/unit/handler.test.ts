import { bootstrap } from "../../services/entitlement-service/src/bootstrap";
import { handler } from "../../services/entitlement-service/src/handler/index";
import { sqsEventFromFixture } from "../helpers/sqs";
import sqsEventFixture from "../fixtures/sqs-event-two-record.json";
import sqsBrokenEventFixture from "../fixtures/sqs-broken-event.json";

jest.mock("../../services/entitlement-service/src/bootstrap", () => ({
  // when calling the module , replace with the fake one
  bootstrap: jest.fn(),
}));

const mockedBootstrap = bootstrap as jest.Mock; // cast the mocked function to the correct type

describe("entitlement-service handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns no batch failures when all records are processed successfully", async () => {
    const execute = jest.fn().mockResolvedValue(undefined); // fake execution that always succeeds

    mockedBootstrap.mockReturnValue({
      processBillingEventUseCase: {
        execute,
      },
    } as any); // return a fake object with the execute function

    const response = await handler(sqsEventFromFixture(sqsEventFixture));

    expect(mockedBootstrap).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].meta.eventId).toBe("evt-1");
    expect(execute.mock.calls[1][0].meta.eventId).toBe("evt-2");
    expect(response.batchItemFailures).toEqual([]);
  });

  it("returns a partial batch failure when the first record fails", async () => {
    const execute = jest // fake execution
      .fn()
      .mockRejectedValueOnce(new Error("boom")) // mocking that the first record processing fails
      .mockResolvedValueOnce(undefined); // mocking that the second record processing succeeds

    mockedBootstrap.mockReturnValue({
      // return fake object
      processBillingEventUseCase: {
        execute,
      },
    } as any);

    const response = await handler(sqsEventFromFixture(sqsEventFixture));

    expect(mockedBootstrap).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
  });

  it("returns a partial batch failure when the second record fails", async () => {
    const execute = jest // fake execution
      .fn()
      .mockResolvedValueOnce(undefined) // mocking that the first record processing succeeds
      .mockRejectedValueOnce(new Error("boom")); // mocking that the second record processing fails

    mockedBootstrap.mockReturnValue({
      // return fake object
      processBillingEventUseCase: {
        execute,
      },
    } as any);

    const response = await handler(sqsEventFromFixture(sqsEventFixture));

    expect(mockedBootstrap).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-2" }]);
  });

  it("returns all records as failed", async () => {
    const execute = jest.fn();

    mockedBootstrap.mockReturnValue({
      processBillingEventUseCase: {
        execute,
      },
    } as any);

    const response = await handler(sqsEventFromFixture(sqsBrokenEventFixture));

    expect(mockedBootstrap).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: "msg-1" },
      { itemIdentifier: "msg-2" },
    ]);
  });
});
