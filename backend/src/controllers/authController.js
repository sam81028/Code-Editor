const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "7d",
  });

const sendAuthResponse = (res, user) => {
  res.json({
    token: signToken(user),
    user: user.toSafeJSON(),
  });
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

exports.register = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const name = String(req.body.name || "").trim();

    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ msg: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email });

    if (existing) {
      return res.status(409).json({ msg: "An account already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name || email.split("@")[0],
      email,
      password: hashedPassword,
    });

    return sendAuthResponse(res, user);
  } catch (error) {
    console.error("Register failed:", error.message);

    if (error.code === 11000) {
      return res.status(409).json({ msg: "An account already exists" });
    }

    if (
      error.name === "MongooseServerSelectionError" ||
      error.message.includes("buffering timed out")
    ) {
      return res.status(503).json({
        msg: "Database connection failed. Check MongoDB URI and Atlas network access.",
      });
    }

    return res.status(500).json({ msg: error.message || "Unable to create account" });
  }
};

exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ msg: "Wrong password" });
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    console.error("Login failed:", error.message);

    if (
      error.name === "MongooseServerSelectionError" ||
      error.message.includes("buffering timed out")
    ) {
      return res.status(503).json({
        msg: "Database connection failed. Check MongoDB URI and Atlas network access.",
      });
    }

    return res.status(500).json({ msg: error.message || "Unable to sign in" });
  }
};

exports.me = async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
};
