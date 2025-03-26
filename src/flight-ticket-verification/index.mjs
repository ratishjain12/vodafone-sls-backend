import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import parser from "lambda-multipart-parser";

const s3Client = new S3Client();
const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
  try {
    const result = await parser.parse(event);

    // Extract transaction ID and ticket image
    const txnId = result.txnId?.trim();
    const ticketImage = result.files[0]; // Directly access first file

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

    // Validate ticket image
    if (!ticketImage) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Flight ticket image is required",
          code: "MISSING_TICKET_IMAGE",
        }),
      };
    }

    // Check file size (5MB limit)
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    const imageBuffer = Buffer.from(ticketImage.content, "binary");
    if (imageBuffer.length > MAX_FILE_SIZE) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Flight ticket image exceeds 5MB limit",
          code: "FILE_SIZE_EXCEEDED",
        }),
      };
    }

    // Check if transaction exists
    const existingTransaction = await docClient.send(
      new GetCommand({
        TableName: process.env.KYC_TABLE,
        Key: { txnId },
      })
    );

    if (!existingTransaction.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "Invalid transaction ID. Please initiate a new transaction.",
          code: "INVALID_TRANSACTION_ID",
        }),
      };
    }

    // Get file extension and construct S3 key
    const fileExt = ticketImage.filename.split(".").pop().toLowerCase();
    const s3Key = `${txnId}/flight-ticket/ticket.${fileExt}`;

    let validationDetails = {};
    let documentStatus = "VERIFIED";

    if (result.failedValidationType) {
      const type = result.failedValidationType.toLowerCase();

      if (type === "all") {
        validationDetails = {
          isValidName: false,
          isValidDestination: false,
        };
        documentStatus = "FAILED";
      } else {
        const validationType = parseInt(result.type);
        switch (validationType) {
          case 1:
            validationDetails.isValidName = false;
            break;
          case 2:
            validationDetails.isValidDestination = false;
            break;
        }
        documentStatus = "FAILED";
      }
    }
    // Upload to S3 and update DynamoDB in parallel
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: s3Key,
          Body: imageBuffer,
          ContentType: ticketImage.contentType,
        })
      ),
      docClient.send(
        new UpdateCommand({
          TableName: process.env.KYC_TABLE,
          Key: { txnId },
          UpdateExpression: `
            SET documents.flightTicket = :ticketDoc,
                #docStatus.flightTicket = :ticketStatus,
                updatedAt = :timestamp
          `,
          ExpressionAttributeNames: {
            "#docStatus": "status",
          },
          ExpressionAttributeValues: {
            ":ticketDoc": {
              image: s3Key,
              ...(Object.keys(validationDetails).length > 0
                ? { validationDetails }
                : {
                    passengerName: existingTransaction.Item.personalInfo.name,
                    flightNumber: "AI 101",
                    departure: "New York (JFK)",
                    arrival: "London (LHR)",
                  }),
            },
            ":ticketStatus": documentStatus,
            ":timestamp": new Date().toISOString(),
          },
        })
      ),
    ]);

    const hasValidationErrors = Object.keys(validationDetails).length > 0;
    if (hasValidationErrors) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: "Flight Ticket verification failed due to mismatched data.",
          isValid: false,
          validationDetails,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Flight ticket verification completed",
        status: "VERIFIED",
        success: true,
        ticketDetails: {
          passengerName: existingTransaction.Item.personalInfo.name,
          flightNumber: "AI 101",
          departure: "New York (JFK)",
          arrival: "London (LHR)",
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error processing flight ticket verification",
        error: error.message,
      }),
    };
  }
};
