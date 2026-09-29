const mockSend = jest.fn();
const mockDocumentClientFrom = jest.fn(() => ({
  send: mockSend,
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: mockDocumentClientFrom,
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn().mockImplementation(input => ({ input })),
  ScanCommand: jest.fn().mockImplementation(input => ({ input })),
}));

import { DynamoTransactionRepository } from "../../../libs/domain/src/transactions/dynamodb/dynamo.transaction.repository";

describe("DynamoTransactionRepository.findByUserId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocumentClientFrom.mockReturnValue({
      send: mockSend,
    });
  });

  it("filters by provider and returns newest transactions first", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            transactionId: "txn_older_powertranz",
            userId: "user_1",
            type: "payment.successful",
            status: "success",
            amount: 100,
            currency: "USD",
            provider: "powertranz",
            createdAt: "2026-08-01T10:00:00.000Z",
            metadata: JSON.stringify({ provider: "powertranz" }),
          },
          {
            transactionId: "txn_newest_stripe",
            userId: "user_1",
            type: "payment.successful",
            status: "success",
            amount: 150,
            currency: "USD",
            provider: "stripe",
            createdAt: "2026-08-03T10:00:00.000Z",
            metadata: JSON.stringify({ provider: "stripe" }),
          },
        ],
        LastEvaluatedKey: {
          PK: "USER#user_1",
          SK: "TRANSACTION#cursor",
        },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            transactionId: "txn_newest_powertranz",
            userId: "user_1",
            type: "payment.successful",
            status: "success",
            amount: 200,
            currency: "USD",
            provider: "powertranz",
            createdAt: "2026-08-04T10:00:00.000Z",
            metadata: JSON.stringify({ provider: "powertranz" }),
          },
        ],
      });

    const repository = new DynamoTransactionRepository("transactions-test");

    const transactions = await repository.findByUserId("user_1", {
      provider: "powertranz",
      limit: 5,
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(transactions.items.map(transaction => transaction.transactionId)).toEqual([
      "txn_newest_powertranz",
      "txn_older_powertranz",
    ]);
    expect(transactions.items.every(transaction => transaction.provider === "powertranz")).toBe(true);
    expect(transactions.hasMore).toBe(false);
  });

  it("applies the limit after sorting by createdAt descending", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          transactionId: "txn_oldest",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 100,
          currency: "USD",
          provider: "stripe",
          createdAt: "2026-08-01T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "stripe" }),
        },
        {
          transactionId: "txn_newest",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 200,
          currency: "USD",
          provider: "stripe",
          createdAt: "2026-08-04T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "stripe" }),
        },
        {
          transactionId: "txn_middle",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 150,
          currency: "USD",
          provider: "stripe",
          createdAt: "2026-08-02T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "stripe" }),
        },
      ],
    });

    const repository = new DynamoTransactionRepository("transactions-test");

    const transactions = await repository.findByUserId("user_1", {
      limit: 2,
    });

    expect(transactions.items.map(transaction => transaction.transactionId)).toEqual([
      "txn_newest",
      "txn_middle",
    ]);
    expect(transactions.hasMore).toBe(true);
    expect(typeof transactions.nextCursor).toBe("string");
  });

  it("uses the cursor to return the next page for the same query", async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          transactionId: "txn_oldest",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 100,
          currency: "USD",
          provider: "powertranz",
          createdAt: "2026-08-01T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "powertranz" }),
        },
        {
          transactionId: "txn_newest",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 200,
          currency: "USD",
          provider: "powertranz",
          createdAt: "2026-08-04T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "powertranz" }),
        },
        {
          transactionId: "txn_middle",
          userId: "user_1",
          type: "payment.successful",
          status: "success",
          amount: 150,
          currency: "USD",
          provider: "powertranz",
          createdAt: "2026-08-02T10:00:00.000Z",
          metadata: JSON.stringify({ provider: "powertranz" }),
        },
      ],
    });

    const repository = new DynamoTransactionRepository("transactions-test");

    const firstPage = await repository.findByUserId("user_1", {
      provider: "powertranz",
      limit: 2,
    });

    const secondPage = await repository.findByUserId("user_1", {
      provider: "powertranz",
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.items.map(transaction => transaction.transactionId)).toEqual([
      "txn_newest",
      "txn_middle",
    ]);
    expect(secondPage.items.map(transaction => transaction.transactionId)).toEqual([
      "txn_oldest",
    ]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});
