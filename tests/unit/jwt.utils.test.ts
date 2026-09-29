import * as jwt from "jsonwebtoken";
import { APIGatewayProxyEvent } from "aws-lambda";
import {
  getCurrentUserFromEvent,
  optionalUser,
  requireUser,
} from "../../libs/domain/src/utils/auth/jwt.utils";
import { AuthenticationError } from "../../libs/domain/src/utils/auth/errors/authentication.error";
import { makeEvent } from "../helpers/apiGatewayProxyEvent";

describe("JWT Utils", () => {
  const secret = process.env.JWT_ACCESS_TOKEN_SECRET;

  beforeEach(() => {
    process.env.JWT_ACCESS_TOKEN_SECRET = "test";
  });

  afterAll(() => {
    process.env.JWT_ACCESS_TOKEN_SECRET = secret; // Restore original secret
  });

  it("should throw a 401 Authentication Erorr when Autherization header is missing", () => {
    const event = makeEvent(); // No Authorization header
    expect(() => requireUser(event)).toThrow(AuthenticationError);
  });

  it("should throw a 401 Authentication Erorr when Authorization header is invalid", () => {
    const event = makeEvent({ Authorization: "InvalidToken" }); // Invalid format
    expect(() => requireUser(event)).toThrow(AuthenticationError);
  });

  it("should throw a 401 Authentication Erorr when token is invalid", () => {
    const token = jwt.sign({ id: "test-user", role: "admin" }, "wrong-secret", {
      expiresIn: "1h",
    });
    const event = makeEvent({ Authorization: `Bearer ${token}` });
    expect(() => requireUser(event)).toThrow(AuthenticationError);
  });

  it("throws AuthenticationError when token payload is missing id", () => {
    const token = jwt.sign(
      { role: "admin" },
      process.env.JWT_ACCESS_TOKEN_SECRET as string,
      { expiresIn: "1h" },
    );

    const event = makeEvent({ Authorization: `Bearer ${token}` });

    expect(() => getCurrentUserFromEvent(event)).toThrow(AuthenticationError);
  });

  it("returns the current user when token is valid", () => {
    const token = jwt.sign(
      { id: "user-1", role: "admin" },
      process.env.JWT_ACCESS_TOKEN_SECRET as string,
      { expiresIn: "1h" },
    );

    const event = makeEvent({ Authorization: `Bearer ${token}` });
    const user = getCurrentUserFromEvent(event);
    expect(user).toEqual({ id: "user-1", role: "admin" });
  });

  it("returns null in optional mode when token is missing", () => {
    const user = optionalUser(makeEvent());

    expect(user).toBeNull();
  });

  it("requireUser throws when token is missing", () => {
    expect(() => requireUser(makeEvent())).toThrow(AuthenticationError);
  });
});
