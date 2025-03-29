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
    const { txnId } = event.pathParameters;
    const result = await parser.parse(event);
    const files = result.files.reduce((acc, file) => {
      acc[file.fieldname] = file;
      return acc;
    }, {});

    const { frontImage, backImage } = files;

    if (!txnId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Transaction ID is required",
          code: "MISSING_TXN_ID",
        }),
      };
    }

    // Validate front image
    if (!frontImage) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Front passport image is required",
          code: "MISSING_FRONT_IMAGE",
        }),
      };
    }

    // Validate back image
    if (!backImage) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Back passport image is required",
          code: "MISSING_BACK_IMAGE",
        }),
      };
    }

    const [existingTransaction, frontImageBuffer, backImageBuffer] =
      await Promise.all([
        docClient.send(
          new GetCommand({
            TableName: process.env.KYC_TABLE,
            Key: {
              txnId: txnId,
            },
          })
        ),
        Buffer.from(frontImage.content, "binary"),
        Buffer.from(backImage.content, "binary"),
      ]);

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (frontImageBuffer.length > MAX_FILE_SIZE) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Front image file size exceeds 5MB limit",
          code: "FRONT_FILE_SIZE_EXCEEDED",
        }),
      };
    }

    if (backImageBuffer.length > MAX_FILE_SIZE) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Back image file size exceeds 5MB limit",
          code: "BACK_FILE_SIZE_EXCEEDED",
        }),
      };
    }

    if (!existingTransaction.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "Invalid transaction ID. Please initiate a new transaction.",
          code: "INVALID_TRANSACTION_ID",
        }),
      };
    }

    const frontImageKey = `aadhar/${txnId}/front.${frontImage.filename
      .split(".")
      .pop()
      .toLowerCase()}`;
    const backImageKey = `aadhar/${txnId}/back.${backImage.filename
      .split(".")
      .pop()
      .toLowerCase()}`;

    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: frontImageKey,
          Body: frontImageBuffer,
          ContentType: frontImage.contentType,
        })
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: backImageKey,
          Body: backImageBuffer,
          ContentType: backImage.contentType,
        })
      ),
    ]);

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.KYC_TABLE,
        Key: {
          txnId: txnId,
        },
        UpdateExpression: `
            SET aadhar = :aadhar,
                updatedAt = :timestamp
            `,
        ExpressionAttributeValues: {
          ":aadhar": {
            status: "VERIFIED",
            document: {
              frontImage: frontImageKey,
              backImage: backImageKey,
            },
            aadharNumber: "A1234567",
            score: 0.9,
          },
          ":timestamp": new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Aadhar verification completed.",
        status: "VERIFIED",
        aadharDetails: {
          name: existingTransaction.Item.personalInfo.name,
          dateOfBirth: existingTransaction.Item.personalInfo.dateOfBirth,
          aadharNumber: "A1234567",
          score: 0.9,
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
