import { APIGatewayProxyResult } from "aws-lambda";

export function response(
  statusCode: number,
  body: unknown
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export function errorResponse(error: any): APIGatewayProxyResult {
  // Domain & app errors
  if (error.name === "NotFoundError") {
    return response(404, {
      error: "NOT_FOUND",
      message: error.message
    });
  }

  if (error.name === "DomainError") {
    return response(400, {
      error: "DOMAIN_ERROR",
      message: error.message
    });
  }

  // Validation (optional)
  if (error.name === "ValidationError") {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: error.message,
      details: error.details
    });
  }

  if (error.name === "AuthenticationError") {
    return response(error.statusCode ?? 401, {
      error: "UNAUTHORIZED",
      message: error.message,
    });
  }

  if (error.name === "ForbiddenError") {
    return response(error.statusCode ?? 403, {
      error: "FORBIDDEN",
      message: error.message,
    });
  }

  // Fallback (log for debugging, but never leak internals to client)
  console.error("Unhandled error:", error);
  console.error("Error stack:", error.stack);
  console.error("Error name:", error.name);
  console.error("Error message:", error.message);

  return response(500, {
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong"
  });
}
