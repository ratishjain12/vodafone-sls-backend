import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);

const calculateOverallStatus = (passport, visa, flightTicket) => {
  if (!passport || !visa || !flightTicket) return "PENDING";

  const documentStatuses = [passport.status, visa.status, flightTicket.status];

  if (documentStatuses.includes("FAILED")) return "FAILED";
  if (documentStatuses.includes("VERIFIED")) return "VERIFIED";
  return "PENDING";
};

export const handler = async (event) => {
  try {
    // Extract transaction ID from query parameters
    const { txnId } = event.pathParameters;

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

    const { passport, visa, flightTicket } = result.Item;
    const overallStatus = calculateOverallStatus(passport, visa, flightTicket);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transaction status retrieved successfully",
        overallStatus,
        documents: {
          passport: {
            status: passport.status,
            score: passport.score,
            document: passport.document,
          },
          visa: {
            status: visa.status,
            score: visa.score,
            document: visa.document,
          },
          flightTicket: {
            status: flightTicket.status,
            score: flightTicket.score,
            document: flightTicket.document,
          },
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
