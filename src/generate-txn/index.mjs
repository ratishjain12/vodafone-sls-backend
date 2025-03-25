import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const validateDateOfBirth = (dob) => {
  const date = new Date(dob);
  const today = new Date();
  return date instanceof Date && !isNaN(date) && date < today;
};

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { name, dateOfBirth } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Name is required",
        }),
      };
    }

    if (!dateOfBirth || !validateDateOfBirth(dateOfBirth)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Valid date of birth is required",
        }),
      };
    }

    const transactionId = uuidv4();
    const timestamp = new Date().toISOString();

    // Create transaction items for metadata and each document type
    const transactionItems = [
      // Main transaction metadata
      {
        Put: {
          TableName: process.env.KYC_TABLE,
          Item: {
            transactionId,
            documentType: "METADATA",
            personalInfo: {
              name: name.trim(),
              dateOfBirth,
            },
            status: {
              overall: "INITIATED",
              passport: "PENDING",
              visa: "PENDING",
              flightTicket: "PENDING",
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      // Passport document record
      {
        Put: {
          TableName: process.env.KYC_TABLE,
          Item: {
            transactionId,
            documentType: "PASSPORT",
            number: null,
            frontImage: null,
            backImage: null,
            verificationStatus: "PENDING",
            updatedAt: timestamp,
          },
        },
      },
      // Visa document record
      {
        Put: {
          TableName: process.env.KYC_TABLE,
          Item: {
            transactionId,
            documentType: "VISA",
            number: null,
            image: null,
            verificationStatus: "PENDING",
            updatedAt: timestamp,
          },
        },
      },
      // Flight ticket document record
      {
        Put: {
          TableName: process.env.KYC_TABLE,
          Item: {
            transactionId,
            documentType: "FLIGHT_TICKET",
            number: null,
            image: null,
            verificationStatus: "PENDING",
            updatedAt: timestamp,
          },
        },
      },
    ];

    // Create all records in a single transaction
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactionItems,
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transaction created successfully",
        data: {
          transactionId,
          personalInfo: {
            name: name.trim(),
            dateOfBirth,
          },
          status: {
            overall: "INITIATED",
            passport: "PENDING",
            visa: "PENDING",
            flightTicket: "PENDING",
          },
          timestamp,
        },
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error generating transaction",
        error: error.message,
      }),
    };
  }
};
