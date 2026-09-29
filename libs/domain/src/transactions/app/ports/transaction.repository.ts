import { Transaction } from "../../domain/entities/transaction.entity";

export interface FindTransactionsOptions {
  limit?: number;
  provider?: string;
  cursor?: string;
}

export interface PaginatedTransactionsResult {
  items: Transaction[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface TransactionRepository {
  save(transaction: Transaction): Promise<void>;
  findByUserId(userId: string, options?: FindTransactionsOptions): Promise<PaginatedTransactionsResult>;
  findAll(limit?: number): Promise<Transaction[]>;
  findById(transactionId: string): Promise<Transaction | null>;
}
