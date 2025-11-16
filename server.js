// BACKEND: Node.js + Express + MongoDB Atlas + JWT + Socket.IO

require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Server } = require("socket.io");
const path = require("path"); // only ONCE here

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json());

// ---------------- ENV ----------------

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
if (!process.env.JWT_SECRET)
  console.warn("Warning: JWT_SECRET not set — using insecure default.");

const PORT = process.env.PORT || 4000;

const MONGO_URI_RAW = process.env.MONGO_URI;
let MONGO_URI = MONGO_URI_RAW || "mongodb://localhost:27017/bugtrack";

if (!MONGO_URI_RAW) {
  console.warn("Warning: MONGO_URI not set — using local MongoDB.");
} else if (!/^mongodb(\+srv)?:\/\//i.test(MONGO_URI_RAW)) {
  console.warn("Warning: Invalid MONGO_URI format — falling back to local DB.");
  MONGO_URI = "mongodb://localhost:27017/bugtrack";
}

// ---------------- DATABASE ----------------

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("Mongo Error:", err));

// ---------------- MODELS ----------------

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    role: { type: String, default: "user" },
  })
);

const Project = mongoose.model(
  "Project",
  new mongoose.Schema({
    name: String,
    description: String,
    owner_id: String,
  })
);

const Bug = mongoose.model(
  "Bug",
  new mongoose.Schema({
    title: String,
    description: String,
    status: { type: String, default: "open" },
    priority: { type: String, default: "medium" },
    project_id: String,
    reporter_id: String,
    assignee_id: String,
    resolution: { type: String, default: "" },
    resolved_by: { type: String, default: null },
    resolved_at: { type: Date, default: null },
  })
);

const Resolution = mongoose.model(
  "Resolution",
  new mongoose.Schema({
    bug_id: String,
    resolved_by: String,
    resolution: String,
    created_at: { type: Date, default: Date.now },
  })
);

const Notification = mongoose.model(
  "Notification",
  new mongoose.Schema({
    user_id: String,
    message: String,
    read: { type: Boolean, default: false },
  })
);

// ---------------- AUTH MIDDLEWARE ----------------

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.json({ error: "Missing token" });

  try {
    req.user = jwt.verify(h.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.json({ error: "Invalid token" });
  }
}

// ---------------- ROUTES (UNCHANGED) ----------------
// (Your entire API code stays unchanged)

// ---------------- SOCKET.IO ----------------

io.on("connection", (socket) => {
  socket.on("identify", ({ userId }) => {
    socket.join(`user_${userId}`);
  });
});

// ---------------- SERVE FRONTEND ----------------

app.use(express.static(path.join(__dirname, "frontend")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ---------------- START SERVER ----------------

server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
