import type { APIGatewayProxyEvent } from "aws-lambda";

export function createApiGatewayEvent(
  overrides?: Partial<APIGatewayProxyEvent>
): APIGatewayProxyEvent {
  return {
    httpMethod: overrides?.httpMethod ?? "GET",
    path: overrides?.path ?? "/products",
    resource: overrides?.resource ?? "/products",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...overrides?.headers,
    },
    queryStringParameters: overrides?.queryStringParameters ?? null,
    pathParameters: overrides?.pathParameters ?? null,
    body: overrides?.body ?? null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api-id",
      authorizer: null,
      httpMethod: overrides?.httpMethod ?? "GET",
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: "127.0.0.1",
        user: null,
        userAgent: "jest-test-agent",
        userArn: null,
      },
      path: overrides?.path ?? "/products",
      protocol: "HTTP/1.1",
      requestId: "test-request-id",
      requestTimeEpoch: Date.now(),
      resourceId: "test-resource",
      resourcePath: "/products",
      stage: "test",
    },
  };
}
