import { APIGatewayProxyEvent } from "aws-lambda";
import { RequestContext } from "./types";

export function parseRequest(event: APIGatewayProxyEvent): RequestContext {
  // Use resource for route matching (contains template like /products/{id})
  // This matches the route definitions which use templates
  const path = event.resource || event.path;

  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value !== undefined && value !== null) {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  const sourceIp =
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.requestContext?.identity?.sourceIp ||
    undefined;

  let body = null;
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      // If body is not valid JSON, throw a clear error
      throw new Error(
        `Invalid JSON in request body: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Filter out undefined values from pathParams and query
  const pathParams: Record<string, string> = {};
  if (event.pathParameters) {
    for (const [key, value] of Object.entries(event.pathParameters)) {
      if (value !== undefined) {
        pathParams[key] = value;
      }
    }
  }

  const query: Record<string, string> = {};
  if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value !== undefined) {
        query[key] = value;
      }
    }
  }
  // Fallback: parse from rawQueryString (e.g. API Gateway HTTP API or when queryStringParameters is missing)
  const rawQuery =
    (event as any).rawQueryString ??
    (typeof event.path === "string" && event.path.includes("?")
      ? event.path.split("?")[1]
      : null);
  if (rawQuery && typeof rawQuery === "string") {
    for (const pair of rawQuery.split("&")) {
      const eq = pair.indexOf("=");
      const key = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : "";
      if (key) {
        try {
          query[decodeURIComponent(key)] = decodeURIComponent(
            value.replace(/\+/g, " "),
          );
        } catch {
          query[key] = value;
        }
      }
    }
  }

  return {
    method: event.httpMethod,
    path: path,
    pathParams: pathParams,
    query: query,
    headers: headers,
    sourceIp: sourceIp,
    body: body,
  };
}
