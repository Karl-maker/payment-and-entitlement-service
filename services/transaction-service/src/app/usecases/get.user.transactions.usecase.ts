import { PaginatedTransactionsResult, TransactionRepository } from "@libs/domain";

export interface GetUserTransactionsInput {
  userId: string;
  limit?: number;
  provider?: string;
  cursor?: string;
}

export class GetUserTransactionsUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository
  ) {}

  async execute(input: GetUserTransactionsInput): Promise<PaginatedTransactionsResult> {
    return await this.transactionRepo.findByUserId(input.userId, {
      limit: input.limit,
      provider: input.provider,
      cursor: input.cursor,
    });
  }
}
