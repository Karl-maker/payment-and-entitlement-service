import { APIGatewayProxyEvent } from "aws-lambda";
import { parseRequest } from "./parse-request";
import { routes } from "./routes";
import { corsHeaders, errorResponse, isProxyResult, response } from "./response";
import { RequestContext } from "./types";
import { requireUser } from "@libs/domain";

function normalizePath(path: string): string {
  if (path.startsWith("/v1/")) {
    return path.substring(3);
  }

  return path;
}

function findRouteHandler(
  method: string,
  path: string,
  pathParams: Record<string, string>,
): ((req: RequestContext) => Promise<any>) | null {
  const normalizedPath = normalizePath(path);
  const pathWithoutQuery = normalizedPath.split("?")[0];

  const exactKey = `${method} ${pathWithoutQuery}`;
  if (routes[exactKey]) {
    return routes[exactKey];
  }

  for (const routeKey of Object.keys(routes)) {
    const [routeMethod, routePath] = routeKey.split(" ", 2);

    if (routeMethod !== method) {
      continue;
    }

    if (!routePath.includes(":")) {
      continue;
    }

    const routeParts = routePath.split("/");
    const pathParts = pathWithoutQuery.split("/");

    if (routeParts.length !== pathParts.length) {
      continue;
    }

    let matches = true;
    const extractedParams: Record<string, string> = {};

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        extractedParams[routeParts[i].substring(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      Object.assign(pathParams, extractedParams);
      return routes[routeKey];
    }
  }

  return null;
}

export async function apiHandler(event: APIGatewayProxyEvent) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { ...corsHeaders }, body: "" };
    }

    const req = parseRequest(event);
    const actualPath = event.path || req.path;
    const normalizedPath = normalizePath(actualPath);
    const pathWithoutQuery = normalizedPath.split("?")[0];

    const needsUser =
      pathWithoutQuery === "/powertranz/payment-intents" ||
      pathWithoutQuery === "/powertranz/invoices";

    const requestWithContext = {
      ...req,
      path: normalizedPath,
      pathParams: req.pathParams || {},
      user: needsUser ? requireUser(event) : undefined,
    };

    const handler = findRouteHandler(
      req.method,
      normalizedPath,
      requestWithContext.pathParams,
    );

    if (!handler) {
      return response(404, { message: "Route not found" });
    }

    const result = await handler(requestWithContext);
    if (isProxyResult(result)) {
      return result;
    }

    return response(200, result);
  } catch (err) {
    return errorResponse(err);
  }
}
