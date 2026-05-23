/**
 * server.js — Smart Attendance System Backend
 *
 * Responsibilities:
 *  1. Serve the vanilla-JS frontend from /public
 *  2. Accept classroom photo uploads and forward them to a Python face-recognition script
 *  3. Confirm a finalised attendance list and save to SQLite database
 *  4. Retrieve saved attendance records
 */

const express   = require("express");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const { spawn } = require("child_process");
const Database  = require("better-sqlite3"); // ← NEW

// ─── App & Port ──────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

const PYTHON_TIMEOUT_MS = 60_000;

// ─── SQLite Database Setup ───────────────────────────────────────────────────  ← NEW

const db = new Database("attendance.db"); // ← NEW — creates attendance.db in project root

// Create the attendance table if it doesn't exist yet
db.exec(`                                
  CREATE TABLE IF NOT EXISTS attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  TEXT    NOT NULL,
    timestamp   TEXT    NOT NULL
  )
`); // ← NEW

console.log("[db] SQLite database ready → attendance.db"); // ← NEW

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Multer — File Upload Configuration ──────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `attendance-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const fileFilter = (_req, file, cb) => {
  const ALLOWED_TYPES = /jpeg|jpg|png|webp/;
  const isValid =
    ALLOWED_TYPES.test(file.mimetype) &&
    ALLOWED_TYPES.test(path.extname(file.originalname).toLowerCase());

  if (isValid) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and WEBP images are accepted."));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Helper — pick the right Python binary ───────────────────────────────────

function getPythonBinary() {
  return process.platform === "win32" ? "python" : "python3";
}

// ─── Helper — extract the first valid JSON line from raw stdout ───────────────

function extractJSON(raw) {
  // Strategy 1: scan lines for a JSON object
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        return { ok: true, data: JSON.parse(line) };
      } catch {
        // not valid JSON, keep scanning
      }
    }
  }

  // Strategy 2: regex to find anything between { and }
  const jsonMatch = raw.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      return { ok: true, data: JSON.parse(jsonMatch[1]) };
    } catch {
      // not valid JSON
    }
  }

  return { ok: false, error: "No valid JSON found in script output." };
}

// ─── Route 1 — POST /api/upload-attendance ───────────────────────────────────

app.post("/api/upload-attendance", upload.single("photo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file was provided." });
  }

  const imagePath = req.file.path;
  console.log(`[upload] Image saved → ${imagePath}`);

  const pythonBinary = getPythonBinary();
  const python = spawn(pythonBinary, ["process_faces.py", imagePath]);

  console.log(`[python] Spawning: ${pythonBinary} process_faces.py ${imagePath}`);

  let stdoutData = "";
  let stderrData = "";
  let responded  = false;

  const timer = setTimeout(() => {
    if (!responded) {
      responded = true;
      python.kill("SIGTERM");
      console.error("[python] Timed out — process killed.");
      return res.status(504).json({ error: "Face-recognition script timed out." });
    }
  }, PYTHON_TIMEOUT_MS);

  python.stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
  python.stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  python.on("close", (code) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;

    const raw = stdoutData.trim();
    console.log("[python] Raw stdout:", JSON.stringify(raw));

    if (stderrData.trim()) {
      console.log("[python] stderr:\n", stderrData.trim());
    }

    if (code !== 0) {
      console.error(`[python] Exited with code ${code}`);
      return res.status(500).json({
        error:   "Face-recognition script exited with an error.",
        details: stderrData.trim() || "No stderr output captured.",
      });
    }

    const parsed = extractJSON(raw);

    if (!parsed.ok) {
      console.error("[python] Could not find valid JSON in stdout.");
      return res.status(500).json({
        error:  "Invalid JSON from script.",
        raw,
        stderr: stderrData.trim(),
      });
    }

    console.log("[python] Parsed result:", parsed.data);
    return res.status(200).json(parsed.data);
  });

  python.on("error", (err) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;

    console.error("[python] Spawn error:", err.message);

    const hint = err.code === "ENOENT"
      ? `"${pythonBinary}" was not found. Is Python installed and added to PATH?`
      : err.message;

    return res.status(500).json({
      error:   "Could not start the face-recognition script.",
      details: hint,
    });
  });
});

// ─── Route 2 — POST /api/confirm-attendance ──────────────────────────────────

app.post("/api/confirm-attendance", (req, res) => {
  const { presentStudentIds } = req.body;

  if (!Array.isArray(presentStudentIds)) {
    return res.status(400).json({
      error: "`presentStudentIds` must be an array of student ID strings.",
    });
  }

  const timestamp = new Date().toISOString();

  // ── Save each student as a row in SQLite ──────────────────────────────────  ← NEW
  try {
    const insert = db.prepare(                                                 // ← NEW
      "INSERT INTO attendance (student_id, timestamp) VALUES (?, ?)"           // ← NEW
    );                                                                         // ← NEW

    // db.transaction ensures ALL inserts succeed or NONE do (atomic)
    const insertMany = db.transaction((ids) => {                               // ← NEW
      for (const id of ids) {                                                  // ← NEW
        insert.run(id, timestamp);                                             // ← NEW
      }                                                                        // ← NEW
    });                                                                        // ← NEW

    insertMany(presentStudentIds);                                             // ← NEW

    console.log("─────────────────────────────────────────");
    console.log(`[attendance] Saved to DB at ${timestamp}`);                  // ← NEW
    console.log(`[attendance] Present (${presentStudentIds.length}):`, presentStudentIds);
    console.log("─────────────────────────────────────────");

    return res.status(200).json({
      message:   "Attendance confirmed and saved to database.",                // ← NEW
      count:     presentStudentIds.length,
      timestamp,
    });

  } catch (err) {                                                              // ← NEW
    console.error("[db] Failed to save attendance:", err.message);             // ← NEW
    return res.status(500).json({ error: "Failed to save attendance to database." }); // ← NEW
  }                                                                            // ← NEW
});

// ─── Route 3 — GET /api/attendance ───────────────────────────────────────────  ← NEW

/**
 * Returns all saved attendance records from the database.
 * Optional query params:
 *   ?student_id=S001          → filter by one student
 *   ?date=2025-01-15          → filter by date (YYYY-MM-DD)
 *
 * Visit in browser: http://localhost:3000/api/attendance
 */
app.get("/api/attendance", (req, res) => {                                     // ← NEW
  try {
    const { student_id, date } = req.query;

    let query  = "SELECT * FROM attendance";
    const params = [];
    const conditions = [];

    if (student_id) {
        conditions.push("student_id = ?");
        params.push(student_id);
    }

    // ← NEW: prefix filter e.g. ?prefix=CSE3
    if (req.query.prefix) {
        conditions.push("student_id LIKE ?");
        params.push(`${req.query.prefix}%`);
    }

    if (date) {
      // timestamp is stored as ISO string — match by date prefix e.g. "2025-01-15"
      conditions.push("timestamp LIKE ?");
      params.push(`${date}%`);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY timestamp DESC";

    const records = db.prepare(query).all(...params);

    console.log(`[db] Fetched ${records.length} attendance records`);
    return res.status(200).json({ count: records.length, records });

  } catch (err) {
    console.error("[db] Failed to fetch attendance:", err.message);
    return res.status(500).json({ error: "Failed to fetch attendance records." });
  }
});                                                                            // ← NEW

// ─── Global Error Handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(400).json({ error: err.message });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Smart Attendance System running → http://localhost:${PORT}`);
});