const { webcrypto } = require("crypto");
const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const roomRoutes = require("./src/routes/roomRoutes");
const runRoutes = require("./src/routes/runRoutes");
const socketHandler = require("./src/socket/socket");

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*",
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "CodeRoom backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/run", runRoutes);

app.use((req, res) => {
  res.status(404).json({ msg: "Route not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ msg: "Server error" });
});

const server = http.createServer(app);
socketHandler(server);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
