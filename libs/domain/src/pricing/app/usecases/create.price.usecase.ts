import { PriceRepository } from "../ports/price.repository.port";
import type { ProductRepository } from "../../../products/app/ports/product.repository.port";
import { Price } from "../../domain/entities/price.entity";
import { BillingType } from "../../domain/value-objects/billing-type.vo";
import { Interval } from "../../domain/value-objects/interval.vo";
import { NotFoundError } from "../../domain/errors/not-found.error";
import { randomUUID } from "crypto";

export class CreatePriceUseCase {
  constructor(
    private readonly repo: PriceRepository,
    private readonly productRepo: ProductRepository
  ) {}

  async execute(input: any) {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      throw new NotFoundError("Product not found");
    }

    const price = Price.create({
      priceId: randomUUID(),
      productId: input.productId,
      billingType: input.billingType as BillingType,
      interval: input.interval as Interval | undefined,
      frequency: input.frequency,
      amount: input.amount,
      currency: input.currency,
      providers: input.providers
    });

    await this.repo.create(price);

    return {
      priceId: price.priceId
    };
  }
}
