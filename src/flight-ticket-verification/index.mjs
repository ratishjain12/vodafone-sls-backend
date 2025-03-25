import parser from "lambda-multipart-parser";
export const handler = async (event) => {
  try {
    console.log("Incoming event:", event);

    const result = await parser.parse(event);
    console.log("Parsed form data:", result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Flight ticket verification endpoint",
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
      }),
    };
  }
};
