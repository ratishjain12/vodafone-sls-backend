export const handler = async (event) => {
  try {
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
