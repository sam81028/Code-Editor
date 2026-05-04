const mongoose = require("mongoose");

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn("MongoDB skipped: MONGO_URI is not configured");
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });
  }
};

module.exports = connectDB;
