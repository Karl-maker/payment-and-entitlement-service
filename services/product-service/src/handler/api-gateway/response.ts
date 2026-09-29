import { APIGatewayProxyResult } from "aws-lambda";

/** CORS headers for all origins */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

export function response(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(error: any): APIGatewayProxyResult {
  // Domain & app errors
  if (error.name === "NotFoundError") {
    return response(404, {
      error: "NOT_FOUND",
      message: error.message,
    });
  }

  // added authtentication and forbidden error handling
  if (error.name === "AuthenticationError") {
    return response(401, {
      error: "AUTHENTICATION_ERROR",
      message: error.message,
    });
  }

  if (error.name === "ForbiddenError") {
    return response(403, {
      error: "FORBIDDEN",
      message: error.message,
    });
  }

  if (error.name === "DomainError") {
    return response(400, {
      error: "DOMAIN_ERROR",
      message: error.message,
    });
  }

  // Validation (optional)
  if (error.name === "ValidationError") {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: error.message,
      details: error.details,
    });
  }

  // Fallback (log for debugging, but never leak internals to client)
  console.error("Unhandled error:", error);
  console.error("Error stack:", error.stack);
  console.error("Error name:", error.name);
  console.error("Error message:", error.message);

  return response(500, {
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
  });
}
