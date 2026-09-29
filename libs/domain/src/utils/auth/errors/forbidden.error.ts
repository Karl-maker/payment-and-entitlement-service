export class ForbiddenError extends Error {
  public readonly statusCode: number;
  public readonly name = "ForbiddenError";

  constructor(message: string = "Forbidden", statusCode: number = 403) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}
