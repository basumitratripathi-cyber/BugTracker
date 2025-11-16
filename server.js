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
const path = require("path");
app.use(express.static(path.join(__dirname, "frontend")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json());

// Basic environment fallbacks and warnings to make local development easier.
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
if (!process.env.JWT_SECRET) console.warn("Warning: JWT_SECRET not set — using insecure default for development.");

const PORT = process.env.PORT || 4000;
if (!process.env.PORT) console.info(`PORT not set, using default ${PORT}`);

const MONGO_URI_RAW = process.env.MONGO_URI;
let MONGO_URI = MONGO_URI_RAW || "mongodb://localhost:27017/bugtrack";
if (!MONGO_URI_RAW) {
  console.warn("Warning: MONGO_URI not set — attempting to connect to local MongoDB at mongodb://localhost:27017/bugtrack");
} else if (!/^mongodb(\+srv)?:\/\//i.test(MONGO_URI_RAW)) {
  console.warn("Warning: MONGO_URI has an unexpected format. Falling back to local MongoDB for development.");
  MONGO_URI = "mongodb://localhost:27017/bugtrack";
}

// ----------------- DATABASE -----------------

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("Mongo Error:", err));

// ----------------- MODELS -----------------

const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: { type: String, default: "user" },
});
const User = mongoose.model("User", UserSchema);

const ProjectSchema = new mongoose.Schema({
  name: String,
  description: String,
  owner_id: String,
});
const Project = mongoose.model("Project", ProjectSchema);

const BugSchema = new mongoose.Schema({
  title: String,
  description: String,
  status: { type: String, default: "open" },
  priority: { type: String, default: "medium" },
  project_id: String,
  reporter_id: String,
  assignee_id: String,
  // resolution fields to store fix notes when a bug is closed
  resolution: { type: String, default: '' },
  resolved_by: { type: String, default: null },
  resolved_at: { type: Date, default: null },
});
const Bug = mongoose.model("Bug", BugSchema);

// Resolution history for audit (who resolved and when)
const ResolutionSchema = new mongoose.Schema({
  bug_id: String,
  resolved_by: String,
  resolution: String,
  created_at: { type: Date, default: Date.now },
});
const Resolution = mongoose.model('Resolution', ResolutionSchema);

const NotificationSchema = new mongoose.Schema({
  user_id: String,
  message: String,
  read: { type: Boolean, default: false },
});
const Notification = mongoose.model("Notification", NotificationSchema);

// ----------------- AUTH MIDDLEWARE -----------------

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

// ----------------- AUTH ROUTES -----------------

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) return res.json({ error: "Email already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed });

  const token = jwt.sign({ id: user._id, email }, JWT_SECRET);

  res.json({ user, token });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ error: "Invalid email/password" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: "Invalid email/password" });

  const token = jwt.sign({ id: user._id, email }, JWT_SECRET);
  res.json({ user, token });
});

// ----------------- USERS -----------------

app.get("/api/users", auth, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// ----------------- PROJECTS -----------------

app.post("/api/projects", auth, async (req, res) => {
  const p = await Project.create({
    name: req.body.name,
    description: req.body.description,
    owner_id: req.user.id,
  });
  res.json(p);
});

app.get("/api/projects", auth, async (req, res) => {
  const projects = await Project.find();
  res.json(projects);
});

// ----------------- BUGS -----------------

app.post("/api/bugs", auth, async (req, res) => {
  const bug = await Bug.create({
    title: req.body.title,
    description: req.body.description,
    priority: req.body.priority,
    project_id: req.body.project_id,
    reporter_id: req.user.id,
    assignee_id: req.body.assignee_id,
  });

  // Create notification
  if (req.body.assignee_id) {
    await Notification.create({
      user_id: req.body.assignee_id,
      message: `You were assigned bug: ${req.body.title}`,
    });

    io.to(`user_${req.body.assignee_id}`).emit("notification", {
      message: `New bug assigned: ${req.body.title}`,
    });
  }

  res.json(bug);
});

app.get("/api/bugs", auth, async (req, res) => {
  const bugs = await Bug.find();
  res.json(bugs);
});

app.put("/api/bugs/:id", auth, async (req, res) => {
  // Update bug document with supplied fields
  await Bug.findByIdAndUpdate(req.params.id, req.body);

  // If the change includes a resolution and status closed, persist an audit entry
  try {
    if (req.body.status === 'closed' && req.body.resolution) {
      await Resolution.create({
        bug_id: req.params.id,
        resolved_by: req.body.resolved_by || req.user.id,
        resolution: req.body.resolution,
        created_at: req.body.resolved_at ? new Date(req.body.resolved_at) : new Date(),
      });
    }
  } catch (e) {
    console.warn('Failed to create resolution audit record', e && e.message);
  }

  // After update, emit a lightweight analytics update to connected clients
  try {
    // total resolved count
    const totalResolved = await Resolution.countDocuments();

    // average resolution time (ms): join resolutions with bugs where bug.resolved_at exists
    const agg = await Resolution.aggregate([
      { $lookup: { from: 'bugs', localField: 'bug_id', foreignField: '_id', as: 'bug' } },
      { $unwind: '$bug' },
      { $match: { 'bug.resolved_at': { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$bug.resolved_at', '$created_at'] } } } }
    ]);
    const avgMs = (agg && agg[0] && agg[0].avgMs) ? Math.round(agg[0].avgMs) : 0;

    // top solvers (by count)
    const top = await Resolution.aggregate([
      { $group: { _id: '$resolved_by', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);
    // resolve user ids to names where possible
    const topSolvers = await Promise.all(top.map(async t => {
      const u = await User.findById(t._id).select('name').lean();
      return { name: (u && u.name) ? u.name : (t._id || 'Unknown'), count: t.count };
    }));

    // compute total resolved by this user (who performed the update)
    let totalResolvedBy = 0;
    try { totalResolvedBy = await Resolution.countDocuments({ resolved_by: req.user.id }); } catch(e) { totalResolvedBy = 0; }

    const payload = { solved: 1, totalResolved, totalResolvedBy, resolvedByUserId: req.user.id, avgResolutionMs: avgMs, topSolvers, timestamp: Date.now() };
    // include priority counts (high/medium/low)
    try {
      const high = await Bug.countDocuments({ priority: 'high' });
      const medium = await Bug.countDocuments({ priority: 'medium' });
      const low = await Bug.countDocuments({ priority: 'low' });
      payload.priorityCounts = { high, medium, low };
      // also include per-user priority counts (closed by this user)
      try {
        const userHigh = await Resolution.countDocuments({ resolved_by: req.user.id, bug_id: { $exists: true } });
        // Note: to compute per-priority resolved-by-user we'd need to join Resolutions and Bugs; provide a best-effort simple count of user's resolved entries
        payload.totalResolvedBy = totalResolvedBy;
      } catch (e2) {
        // ignore
      }
    } catch(e) { payload.priorityCounts = { high:0, medium:0, low:0 }; }
    io.emit('analysis', payload);
  } catch (e) {
    console.warn('Failed to compute/emit analytics', e && e.message);
  }

  res.json({ success: true });
});

// Analytics endpoints (protected)
app.get('/api/analytics/summary', auth, async (req, res) => {
  try {
    const totalResolved = await Resolution.countDocuments();
    const agg = await Resolution.aggregate([
      { $lookup: { from: 'bugs', localField: 'bug_id', foreignField: '_id', as: 'bug' } },
      { $unwind: '$bug' },
      { $match: { 'bug.resolved_at': { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$bug.resolved_at', '$created_at'] } } } }
    ]);
    const avgMs = (agg && agg[0] && agg[0].avgMs) ? Math.round(agg[0].avgMs) : 0;
    const top = await Resolution.aggregate([
      { $group: { _id: '$resolved_by', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);
    const topSolvers = await Promise.all(top.map(async t => {
      const u = await User.findById(t._id).select('name').lean();
      return { name: (u && u.name) ? u.name : (t._id || 'Unknown'), count: t.count };
    }));

    // also include priorityCounts for initial summary
    try {
      const high = await Bug.countDocuments({ priority: 'high' });
      const medium = await Bug.countDocuments({ priority: 'medium' });
      const low = await Bug.countDocuments({ priority: 'low' });
      // compute total resolved by requesting user
      try {
        const totalResolvedByReqUser = await Resolution.countDocuments({ resolved_by: req.user.id });
        res.json({ totalResolved, totalResolvedBy: totalResolvedByReqUser, avgResolutionMs: avgMs, topSolvers, priorityCounts: { high, medium, low } });
      } catch (e2) {
        res.json({ totalResolved, totalResolvedBy: 0, avgResolutionMs: avgMs, topSolvers, priorityCounts: { high, medium, low } });
      }
    } catch (e2) {
      res.json({ totalResolved, avgResolutionMs: avgMs, topSolvers, priorityCounts: { high:0, medium:0, low:0 } });
    }
  } catch (e) {
    res.json({ error: 'Failed to compute analytics' });
  }
});


// Create a resolution entry for a bug (separate audit endpoint)
app.post('/api/bugs/:id/resolutions', auth, async (req, res) => {
  const { resolution, resolved_by } = req.body;
  const entry = await Resolution.create({ bug_id: req.params.id, resolution, resolved_by: resolved_by || req.user.id });
  res.json(entry);
});

// Get resolution history for a bug (most recent first)
app.get('/api/bugs/:id/resolutions', auth, async (req, res) => {
  const list = await Resolution.find({ bug_id: req.params.id }).sort({ created_at: -1 });
  res.json(list);
});

app.delete("/api/bugs/:id", auth, async (req, res) => {
  await Bug.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ----------------- NOTIFICATIONS -----------------

app.get("/api/notifications", auth, async (req, res) => {
  const notes = await Notification.find({ user_id: req.user.id });
  res.json(notes);
});

// ----------------- REPORTS -----------------

app.get("/api/reports/summary", auth, async (req, res) => {
  const total = await Bug.countDocuments();
  const open = await Bug.countDocuments({ status: "open" });
  const closed = await Bug.countDocuments({ status: "closed" });

  const byPriority = await Bug.aggregate([
    { $group: { _id: "$priority", count: { $sum: 1 } } },
  ]);

  res.json({
    total,
    open,
    closed,
    byPriority,
  });
});

// ----------------- SOCKET -----------------

io.on("connection", (socket) => {
  socket.on("identify", ({ userId }) => {
    socket.join(`user_${userId}`);
  });
});

// ----------------- START SERVER -----------------

server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

