const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  try {
    console.log("MongoDB connecting", {
      node: process.version,
      hasMongoUri: Boolean(process.env.MONGO_URI),
    });

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });
    throw error;
  }
};

module.exports = connectDB;
