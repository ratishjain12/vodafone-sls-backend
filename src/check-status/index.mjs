import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);

const calculateOverallStatus = (status) => {
  if (!status) return "PENDING";

  const documentStatuses = [status.passport, status.visa, status.flightTicket];

  if (documentStatuses.includes("FAILED")) return "FAILED";
  if (documentStatuses.includes("PENDING")) return "PENDING";
  return "VERIFIED";
};

export const handler = async (event) => {
  try {
    // Extract transaction ID from query parameters
    const txnId = event.queryStringParameters?.txnId?.trim();

    // Validate transaction ID
    if (!txnId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Transaction ID is required",
          code: "MISSING_TXN_ID",
        }),
      };
    }

    // Get transaction details from DynamoDB
    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.KYC_TABLE,
        Key: { txnId },
      })
    );

    // Check if transaction exists
    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "Transaction not found",
          code: "TXN_NOT_FOUND",
        }),
      };
    }

    const { status } = result.Item;
    const overallStatus = calculateOverallStatus(status);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transaction status retrieved successfully",
        overallStatus,
        documents: {
          passport: status?.passport || "PENDING",
          visa: status?.visa || "PENDING",
          flightTicket: status?.flightTicket || "PENDING",
        },
      }),
    };
  } catch (error) {
    console.error("Error retrieving transaction status:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error retrieving transaction status",
        error: error.message,
      }),
    };
  }
};
