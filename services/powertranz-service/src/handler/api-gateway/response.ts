import { APIGatewayProxyResult } from "aws-lambda";

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

export function redirect(location: string): APIGatewayProxyResult {
  return {
    statusCode: 303,
    headers: {
      Location: location,
      ...corsHeaders,
    },
    body: "",
  };
}

export function isProxyResult(value: unknown): value is APIGatewayProxyResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as APIGatewayProxyResult).statusCode === "number";
}

function errorNameFromStatus(statusCode: number): string {
  if (statusCode === 400) return "BAD_REQUEST";
  if (statusCode === 401) return "UNAUTHORIZED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  return "ERROR";
}

export function errorResponse(error: any): APIGatewayProxyResult {
  const statusCode =
    typeof error?.statusCode === "number" ? error.statusCode : undefined;

  if (statusCode) {
    return response(statusCode, {
      error: errorNameFromStatus(statusCode),
      message: error.message || "Request failed",
      ...(error.details ? { details: error.details } : {}),
    });
  }

  if (error?.name === "ValidationError") {
    return response(400, {
      error: "BAD_REQUEST",
      message: error.message || "Validation failed",
      ...(error.details ? { details: error.details } : {}),
    });
  }

  if (error?.name === "DomainError") {
    return response(400, {
      error: "BAD_REQUEST",
      message: error.message || "Domain error",
    });
  }

  if (error?.name === "NotFoundError") {
    return response(404, {
      error: "NOT_FOUND",
      message: error.message || "Not found",
    });
  }

  console.error("Unhandled error:", error);

  return response(500, {
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
  });
}
