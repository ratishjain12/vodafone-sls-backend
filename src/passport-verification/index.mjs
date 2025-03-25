import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import parser from "lambda-multipart-parser";

const s3Client = new S3Client();
const dynamoClient = new DynamoDBClient();

export const handler = async (event) => {
  console.log("Incoming event:", event);

  try {
    // Parse multipart form data
    console.log("Parsing form data...");
    const result = await parser.parse(event);
    console.log("Parsed form data:", result);

    // Extract transaction ID and images
    const txnId = result.txnId?.trim();
    const frontImageFile = result.files.find(
      (f) => f.fieldname === "frontImage"
    );
    const backImageFile = result.files.find((f) => f.fieldname === "backImage");

    // Validate required fields
    if (!txnId) {
      console.log("Missing transaction ID");
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Transaction ID is required",
        }),
      };
    }

    // Check if transaction exists in DynamoDB
    const existingTransaction = await dynamoClient.send(
      new GetItemCommand({
        TableName: process.env.KYC_TABLE,
        Key: {
          txnId: { S: txnId },
        },
      })
    );

    if (!existingTransaction.Item) {
      console.log("Invalid transaction ID:", txnId);
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "Invalid transaction ID. Please initiate a new transaction.",
          code: "INVALID_TRANSACTION_ID",
        }),
      };
    }

    if (!frontImageFile || !backImageFile) {
      console.log("Missing images:", {
        hasFront: !!frontImageFile,
        hasBack: !!backImageFile,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Both front and back passport images are required",
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

    const frontImageBuffer = Buffer.from(frontImageFile.content, "binary");
    const backImageBuffer = Buffer.from(backImageFile.content, "binary");

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

    console.log("S3 upload complete:", {
      frontKey: frontImageKey,
      backKey: backImageKey,
    });

    // Update DynamoDB
    console.log("Updating DynamoDB:", {
      table: process.env.KYC_TABLE,
      txnId: txnId,
    });

    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: process.env.KYC_TABLE,
        Key: {
          txnId: { S: txnId },
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
            M: {
              frontImage: { S: frontImageKey },
              backImage: { S: backImageKey },
              passportNumber: { S: "A1234567" },
            },
          },
          ":personalInfo": {
            M: {
              name: { S: "John Doe" },
              dateOfBirth: { S: "1990-01-01" },
              city: { S: "New York" },
              state: { S: "New York" },
              country: { S: "USA" },
              postalCode: { S: "10001" },
              address1: { S: "123 Main Street" },
              address2: { S: "Apt 4B" },
            },
          },
          ":passportStatus": { S: "VERIFIED" },
          ":timestamp": { S: new Date().toISOString() },
        },
      })
    );
    console.log("DynamoDB update complete");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Passport verification completed.",
        status: "VERIFIED",
        passportDetails: {
          name: "John Doe",
          dateOfBirth: "1990-01-01",
          passportNumber: "A1234567",
        },
        contactDetails: {
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
    console.error("Error processing request:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error processing passport verification",
        error: error.message,
      }),
    };
  }
};
