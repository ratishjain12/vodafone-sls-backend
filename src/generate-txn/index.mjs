import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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
    const { name, dateOfBirth, country } = body;

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

    const txnId = uuidv4();
    const timestamp = new Date().toISOString();

    // Create the item directly without transaction wrapper
    await docClient.send(
      new PutCommand({
        TableName: process.env.KYC_TABLE,
        Item: {
          txnId,
          personalInfo: {
            name: name.trim(),
            dateOfBirth,
            country,
          },
          status: {
            passport: "PENDING",
            visa: "PENDING",
            flightTicket: "PENDING",
          },
          documents: {
            passport: {
              frontImage: null,
              backImage: null,
            },
            visa: {
              image: null,
            },
            flightTicket: {
              image: null,
            },
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transaction created successfully",
        data: {
          txnId,
          personalInfo: {
            name: name.trim(),
            dateOfBirth,
            country,
          },
          status: {
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
