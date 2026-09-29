import { APIGatewayProxyEvent } from "aws-lambda";
import { RequestContext } from "./types";

export function parseRequest(event: APIGatewayProxyEvent): RequestContext {
  const path = event.resource || event.path;

  let body = null;
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      throw new Error(
        `Invalid JSON in request body: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  return {
    method: event.httpMethod,
    path: path,
    pathParams: pathParams,
    query: query,
    body: body,
    headers: headers,
  };
}
