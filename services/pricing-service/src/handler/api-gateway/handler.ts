import { APIGatewayProxyEvent } from "aws-lambda";
import { parseRequest } from "./parse-request";
import { routes } from "./routes";
import { response, errorResponse } from "./response";
import { requireUser, optionalUser } from "@libs/domain";

/**
 * Normalizes the path by removing /v1 prefix if present
 */
function normalizePath(path: string): string {
  if (path.startsWith("/v1/")) {
    return path.substring(3); // Remove "/v1"
  }
  return path;
}

/**
 * Extracts path parameters from a path based on a route pattern
 * Example: extractPathParams("/prices/123", "/prices/{id}") => { id: "123" }
 */
function extractPathParams(
  path: string,
  routePattern: string,
): Record<string, string> {
  const params: Record<string, string> = {};
  const pathSegments = path.split("/").filter((s) => s.length > 0);
  const patternSegments = routePattern.split("/").filter((s) => s.length > 0);

  if (pathSegments.length !== patternSegments.length) {
    return params;
  }

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i];
    if (patternSegment.startsWith("{") && patternSegment.endsWith("}")) {
      const paramName = patternSegment.slice(1, -1); // Remove { and }
      params[paramName] = pathSegments[i];
    }
  }

  return params;
}

/**
 * Finds a matching route handler and extracts path parameters
 * Returns the handler and extracted path parameters
 */
function findRouteHandler(
  method: string,
  path: string,
): {
  handler: ((req: any) => Promise<any>) | null;
  pathParams: Record<string, string>;
} {
  const normalizedPath = normalizePath(path);
  const pathWithoutQuery = normalizedPath.split("?")[0]; // Remove query string

  // First try exact match with normalized path
  const exactKey = `${method} ${normalizedPath}`;
  if (routes[exactKey]) {
    return { handler: routes[exactKey], pathParams: {} };
  }

  // Try exact match with path without query params
  const exactKeyNoQuery = `${method} ${pathWithoutQuery}`;
  if (routes[exactKeyNoQuery]) {
    return { handler: routes[exactKeyNoQuery], pathParams: {} };
  }

  // Sort routes by specificity (more path segments first, then longer paths)
  // This ensures /prices/product/{productId} is checked before /prices/{id}
  const sortedRoutes = Object.entries(routes)
    .filter(([routeKey]) => routeKey.startsWith(`${method} `))
    .sort(([a], [b]) => {
      const pathA = a.split(" ", 2)[1];
      const pathB = b.split(" ", 2)[1];
      // Count path segments (more segments = more specific)
      const segmentsA = pathA.split("/").filter((s) => s.length > 0).length;
      const segmentsB = pathB.split("/").filter((s) => s.length > 0).length;
      if (segmentsB !== segmentsA) {
        return segmentsB - segmentsA; // More segments first
      }
      return pathB.length - pathA.length; // Longer paths first
    });

  // Then try partial match - check if path matches any route pattern
  for (const [routeKey, handler] of sortedRoutes) {
    const [, routePath] = routeKey.split(" ", 2);

    // For parameterized routes like /prices/{id}, check if path matches the pattern
    // Convert route pattern to regex: /prices/{id} -> /prices/[^/]+$
    // This ensures we match the ENTIRE path, not just a prefix
    const routePattern = routePath.replace(/\{[^}]+\}/g, "[^/]+");
    // Match the entire path exactly (anchor to start and end)
    const routeRegex = new RegExp(`^${routePattern}$`);

    if (routeRegex.test(pathWithoutQuery)) {
      // Extract path parameters from the matched route
      const pathParams = extractPathParams(pathWithoutQuery, routePath);
      return { handler, pathParams };
    }

    // For exact non-parameterized routes, check if path exactly matches
    if (pathWithoutQuery === routePath) {
      return { handler, pathParams: {} };
    }
  }

  return { handler: null, pathParams: {} };
}

export async function apiHandler(event: APIGatewayProxyEvent) {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));
    console.log("Environment variables:", {
      PRICES_TABLE: process.env.PRICES_TABLE,
      AWS_REGION: process.env.AWS_REGION,
    });

    const req = parseRequest(event);
    // Use the actual path (event.path) for route matching, not the resource template
    // event.path is the actual request path like /prices/123
    // event.resource is the template like /prices/{id}
    const actualPath = event.path || req.path;
    const normalizedPath = normalizePath(actualPath);

    console.log("Parsed request:", {
      method: req.method,
      resourcePath: req.path,
      actualPath: actualPath,
      normalizedPath: normalizedPath,
      pathParams: req.pathParams,
    });

    // Update the path in the request context to the normalized version
    const normalizedReq = {
      ...req,
      path: normalizedPath,
    };

    const { handler, pathParams: extractedPathParams } = findRouteHandler(
      req.method,
      normalizedPath,
    );
    console.log("Found handler:", handler ? "yes" : "no");
    console.log("Extracted path params:", extractedPathParams);

    if (!handler) {
      console.log("No handler found for:", `${req.method} ${req.path}`);
      return response(404, { message: "Route not found" });
    }

    // Merge extracted path parameters with any existing ones from API Gateway
    const mergedPathParams = {
      ...req.pathParams,
      ...extractedPathParams,
    };

    const pathOnly = normalizedPath.split("?")[0].replace(/\/$/, "") || "/";
    const isPostPrices = req.method === "POST" && pathOnly === "/prices";
    const isGetPriceById =
      req.method === "GET" && /^\/prices\/[^/]+$/.test(pathOnly);

    let user: { id: string; role?: string } | undefined;
    if (isPostPrices || isGetPriceById) {
      user = requireUser(event) ?? undefined;
    } else {
      user = optionalUser(event) ?? undefined;
    }

    const finalReq = {
      ...normalizedReq,
      pathParams: mergedPathParams,
      user,
    };

    console.log("Final request context pathParams:", finalReq.pathParams);

    const result = await handler(finalReq);
    console.log("Handler executed successfully");

    // Simple status inference
    if (req.method === "POST") {
      return response(201, result);
    }

    if (req.method === "DELETE") {
      return response(204, null);
    }

    return response(200, result);
  } catch (err) {
    console.error("Error in apiHandler:", err);
    return errorResponse(err);
  }
}
