import parser from "lambda-multipart-parser";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const s3Client = new S3Client();
const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
  try {
    const result = await parser.parse(event);

    // Validate required fields
    if (!result.files?.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Visa document is required",
          success: false,
        }),
      };
    }

    if (!result.country) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Country is required",
          success: false,
        }),
      };
    }

    if (!result.txnId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Transaction ID is required",
          success: false,
        }),
      };
    }

    const visaDocument = result.files[0];
    const { country, txnId } = result;

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
    const fileExt = visaDocument.filename.split(".").pop().toLowerCase();
    const s3Key = `${txnId}/visa/visa-document.${fileExt}`;
    const documentBuffer = Buffer.from(visaDocument.content, "binary");
    // Get user details from existing transaction
    const { name, dateOfBirth } = existingTransaction.Item.personalInfo;

    // Prepare visa details
    const visaDetails = {
      name: name,
      dateOfBirth: dateOfBirth,
      country: country,
      visaNumber: "AC" + Math.floor(1000000 + Math.random() * 9000000),
      visaType: "MULTIPLE JOURNEY",
    };

    // Upload to S3 and update DynamoDB in parallel
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: s3Key,
          Body: documentBuffer,
          ContentType: visaDocument.contentType,
        })
      ),
      docClient.send(
        new UpdateCommand({
          TableName: process.env.KYC_TABLE,
          Key: { txnId },
          UpdateExpression: `
            SET documents.visa = :visaDoc,
                #docStatus.visa = :visaStatus,
                updatedAt = :timestamp
          `,
          ExpressionAttributeNames: {
            "#docStatus": "status",
          },
          ExpressionAttributeValues: {
            ":visaDoc": {
              document: s3Key,
              ...visaDetails,
            },
            ":visaStatus": "VERIFIED",
            ":timestamp": new Date().toISOString(),
          },
        })
      ),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Visa document verification completed",
        status: "VERIFIED",
        visaDetails,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
        success: false,
      }),
    };
  }
};
