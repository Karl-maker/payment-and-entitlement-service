import {
  DynamoPriceRepository,
  DynamoProductRepository,
  CreatePriceUseCase,
  GetPriceUseCase,
  DeletePriceUseCase,
  ListPricesByProductUseCase,
  UpdatePriceUseCase,
} from "@libs/domain";
import { CreatePriceController } from "./app/controllers/create.price.controller";
import { GetPriceController } from "./app/controllers/get.price.controller";
import { ListPricesByProductController } from "./app/controllers/list.prices.by.product.controller";
import { UpdatePriceController } from "./app/controllers/update.price.controller";
import { DeletePriceController } from "./app/controllers/delete.price.controller";

export function bootstrap() {
  const priceRepo = new DynamoPriceRepository();
  const productRepo = new DynamoProductRepository();

  return {
    createPriceController: new CreatePriceController(
      new CreatePriceUseCase(priceRepo, productRepo)
    ),
    getPriceController: new GetPriceController(
      new GetPriceUseCase(priceRepo)
    ),
    listPricesByProductController: new ListPricesByProductController(
      new ListPricesByProductUseCase(priceRepo)
    ),
    updatePriceController: new UpdatePriceController(
      new UpdatePriceUseCase(priceRepo)
    ),
    deletePriceController: new DeletePriceController(
      new DeletePriceUseCase(priceRepo)
    )
  };
}
