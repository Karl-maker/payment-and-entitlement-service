import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { apiHandler } from "./api-gateway/handler";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return apiHandler(event);
};
