import { APIGatewayProxyEvent } from "aws-lambda";
import { RequestContext } from "./types";

export function parseRequest(event: APIGatewayProxyEvent): RequestContext {
  const path = event.resource || event.path;

  let body: any = null;
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      const contentType =
        event.headers?.["content-type"] || event.headers?.["Content-Type"] || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(event.body));
      } else {
        body = event.body;
      }
    }
  }

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

  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value !== undefined) {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  return {
    method: event.httpMethod,
    path,
    pathParams,
    query,
    body,
    headers,
    rawBody: event.body || undefined,
  };
}
