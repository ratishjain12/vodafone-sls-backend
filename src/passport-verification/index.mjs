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
    console.log("Parsed form data:", result);

    // Extract transaction ID and images
    const txnId = result.txnId?.trim();
    const frontImageFile = result.files.find(
      (f) => f.fieldname === "frontImage"
    );
    const backImageFile = result.files.find((f) => f.fieldname === "backImage");

    // Validate transaction ID
    if (!txnId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Transaction ID is required",
        }),
      };
    }

    // Validate front image
    if (!frontImageFile) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Front passport image is required",
          code: "MISSING_FRONT_IMAGE",
        }),
      };
    }

    // Validate back image
    if (!backImageFile) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Back passport image is required",
          code: "MISSING_BACK_IMAGE",
        }),
      };
    }

    // Run transaction check and file preparations in parallel
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
        Buffer.from(frontImageFile.content, "binary"),
        Buffer.from(backImageFile.content, "binary"),
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

    // Get file extensions from original filenames
    const frontImageExt = frontImageFile.filename
      .split(".")
      .pop()
      .toLowerCase();
    const backImageExt = backImageFile.filename.split(".").pop().toLowerCase();

    // Construct S3 keys (keeping original file extensions)
    const frontImageKey = `${txnId}/passport/front.${frontImageExt}`;
    const backImageKey = `${txnId}/passport/back.${backImageExt}`;

    // Upload images to S3 with correct content type
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: frontImageKey,
          Body: frontImageBuffer,
          ContentType: frontImageFile.contentType,
        })
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.DOCUMENTS_BUCKET,
          Key: backImageKey,
          Body: backImageBuffer,
          ContentType: backImageFile.contentType,
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
          SET documents.passport = :passportDoc,
              personalInfo = :personalInfo,
              #docStatus.passport = :passportStatus,
              updatedAt = :timestamp
        `,
        ExpressionAttributeNames: {
          "#docStatus": "status",
        },
        ExpressionAttributeValues: {
          ":passportDoc": {
            frontImage: frontImageKey,
            backImage: backImageKey,
            passportNumber: "A1234567",
          },
          ":personalInfo": {
            name: existingTransaction.Item.personalInfo.name,
            dateOfBirth: existingTransaction.Item.personalInfo.dateOfBirth,
            city: "New York",
            state: "New York",
            country: "USA",
            postalCode: "10001",
            address1: "123 Main Street",
            address2: "Apt 4B",
          },
          ":passportStatus": "VERIFIED",
          ":timestamp": new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Passport verification completed.",
        status: "VERIFIED",
        passportDetails: {
          name: existingTransaction.Item.personalInfo.name,
          dateOfBirth: existingTransaction.Item.personalInfo.dateOfBirth,
          passportNumber: "A1234567",
        },
        address: {
          city: "New York",
          state: "New York",
          country: "USA",
          postalCode: "10001",
          address1: "123 Main Street",
          address2: "Apt 4B",
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error processing passport verification",
        error: error.message,
      }),
    };
  }
};
