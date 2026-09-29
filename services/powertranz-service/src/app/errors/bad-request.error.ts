export class BadRequestError extends Error {
  public readonly statusCode: number;
  public readonly name = "BadRequestError";

  constructor(message: string = "Bad Request", statusCode: number = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}
