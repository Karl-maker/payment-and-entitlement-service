import { APIGatewayProxyEvent } from "aws-lambda";

export function makeEvent(
  headers: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    body: null,
    headers,
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/test",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "/test",
  } as APIGatewayProxyEvent;
}
