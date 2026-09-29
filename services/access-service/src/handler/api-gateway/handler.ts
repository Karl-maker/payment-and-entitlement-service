import { APIGatewayProxyEvent } from "aws-lambda";
import { parseRequest } from "./parse-request";
import { routes } from "./routes";
import { response, errorResponse, corsHeaders } from "./response";
import { requireUser } from "@libs/domain";

/**
 * Normalizes the path by removing /v1 prefix if present
 */
function normalizePath(path: string): string {
  if (path.startsWith("/v1/")) {
    return path.substring(3); // Remove "/v1"mr
  }
  return path;
}

/**
 * Finds a matching route handler
 * Supports path parameters like /access/:key
 */
function findRouteHandler(
  method: string,
  path: string,
  pathParams: Record<string, string>,
): ((req: any) => Promise<any>) | null {
  const normalizedPath = normalizePath(path);
  const pathWithoutQuery = normalizedPath.split("?")[0]; // Remove query string

  // Try exact match first
  const exactKey = `${method} ${pathWithoutQuery}`;
  if (routes[exactKey]) {
    return routes[exactKey];
  }

  // Try pattern matching for path parameters (e.g., /access/:key)
  for (const routeKey of Object.keys(routes)) {
    const [routeMethod, routePath] = routeKey.split(" ", 2);

    if (routeMethod !== method) {
      continue;
    }

    // Check if route has path parameters (contains :param)
    if (routePath.includes(":")) {
      const routeParts = routePath.split("/");
      const pathParts = pathWithoutQuery.split("/");

      if (routeParts.length === pathParts.length) {
        let matches = true;
        const extractedParams: Record<string, string> = {};

        for (let i = 0; i < routeParts.length; i++) {
          if (routeParts[i].startsWith(":")) {
            // This is a parameter, extract it
            const paramName = routeParts[i].substring(1);
            extractedParams[paramName] = pathParts[i];
          } else if (routeParts[i] !== pathParts[i]) {
            // Path segments don't match
            matches = false;
            break;
          }
        }

        if (matches) {
          // Merge extracted params into pathParams
          Object.assign(pathParams, extractedParams);
          return routes[routeKey];
        }
      }
    }
  }

  return null;
}

export async function apiHandler(event: APIGatewayProxyEvent) {
  try {
    // CORS preflight: respond to OPTIONS with 204 and CORS headers
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { ...corsHeaders }, body: "" };
    }

    console.log("Received event:", JSON.stringify(event, null, 2));
    console.log("Environment variables:", {
      ENTITLEMENTS_TABLE: process.env.ENTITLEMENTS_TABLE,
      JWT_ACCESS_TOKEN_SECRET: process.env.JWT_ACCESS_TOKEN_SECRET
        ? "***"
        : undefined,
      AWS_REGION: process.env.AWS_REGION,
    });

    // Extract and verify JWT token to get user details
    const user = requireUser(event);
    console.log("Authenticated user:", { id: user.id, role: user.role });

    const req = parseRequest(event);
    const actualPath = event.path || req.path;
    const normalizedPath = normalizePath(actualPath);

    console.log("Parsed request:", {
      method: req.method,
      resourcePath: req.path,
      actualPath: actualPath,
      normalizedPath: normalizedPath,
    });

    // Add user to request context
    const requestWithUser = {
      ...req,
      path: normalizedPath,
      user: user,
    };

    const handler = findRouteHandler(
      req.method,
      normalizedPath,
      requestWithUser.pathParams,
    );
    console.log("Found handler:", handler ? "yes" : "no");

    if (!handler) {
      console.log("No handler found for:", `${req.method} ${req.path}`);
      return response(404, { message: "Route not found" });
    }

    const result = await handler(requestWithUser);
    console.log("Handler executed successfully");

    return response(200, result);
  } catch (err) {
    console.error("Error in apiHandler:", err);
    return errorResponse(err);
  }
}
