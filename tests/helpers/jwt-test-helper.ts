import jwt from "jsonwebtoken";

/**
 * Creates a JWT signed with JWT_ACCESS_TOKEN_SECRET for e2e tests.
 * Role is taken from the decoded token by the app (admin/administrator allowed for write operations).
 */
export function createJwtWithRole(
  role: string,
  userId: string = "test-user-e2e"
): string {
  const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_ACCESS_TOKEN_SECRET must be set for tests that use createJwtWithRole"
    );
  }
  return jwt.sign(
    { id: userId, role },
    secret,
    { expiresIn: "1h" }
  );
}

/**
 * Creates an expired JWT for e2e tests. Use to assert that endpoints return 401 Unauthorized.
 */
export function createExpiredJwt(
  role: string = "admin",
  userId: string = "test-user-e2e"
): string {
  const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_ACCESS_TOKEN_SECRET must be set for tests that use createExpiredJwt"
    );
  }
  return jwt.sign(
    { id: userId, role },
    secret,
    { expiresIn: "-1h" }
  );
}
