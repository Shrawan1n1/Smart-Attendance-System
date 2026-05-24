# 📸 Smart Attendance System

An automated attendance tracking system that uses **face recognition** to identify students from a classroom photo. Built with a **Node.js/Express** backend, **vanilla JavaScript** frontend, and a **Python** face recognition engine powered by `face_recognition` and `dlib`.

---

## ✨ Features

- 📷 Upload a classroom photo to automatically detect and identify students
- 🧠 Face recognition powered by Python's `face_recognition` library
- ✅ Human review step — confirm or remove detected students before saving
- 💾 Attendance records saved to a **SQLite** database
- 🔍 Query attendance by student ID, prefix, or date via REST API
- 🖥️ Clean, responsive vanilla JS frontend with drag-and-drop upload

---

## 🗂️ Project Structure

```
smart-attendance-system/
│
├── public/                  # Frontend (served as static files)
│   ├── index.html           # UI — upload, review, confirm steps
│   ├── style.css            # Styles
│   └── app.js               # Frontend logic
│
├── known_faces/             # Reference photos — one per student, named by ID
│   ├── S0001.jpg
│   └── S0002.jpg
│
├── uploads/                 # Auto-created — stores uploaded classroom photos
│
├── process_faces.py         # Python face recognition script
├── requirements.txt         # Python dependencies
├── server.js                # Express backend
├── package.json             # Node.js dependencies
├── attendance.db            # SQLite database (auto-created on first confirm)
└── README.md
```

---

## ⚙️ Prerequisites

Make sure the following are installed before setup:

| Tool | Version | Download |
|---|---|---|
| Node.js | LTS | [nodejs.org](https://nodejs.org) |
| Python | 3.10 (recommended) | [python.org](https://www.python.org/downloads/release/python-31011/) |
| Git | Latest | [git-scm.com](https://git-scm.com/downloads) |

> ⚠️ **Python 3.10 is strongly recommended.** Python 3.12+ breaks `dlib` and `face_recognition`. NumPy must be version 1.x (`pip install "numpy<2"`).

---

## 🚀 Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Shrawan1n1/Smart-Attendance-System.git
cd smart-attendance-system
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
# Step 1 — install all libraries
pip install -r requirements.txt

# Step 2 — install the face recognition model weights (must be done separately)
python -m pip install git+https://github.com/ageitgey/face_recognition_models
```

### 4. Verify Python Installation

```bash
python -c "import dlib; print('dlib OK')"
python -c "import face_recognition; print('face_recognition OK')"
python -c "import face_recognition_models; print('models OK')"
python -c "import numpy; print('numpy', numpy.__version__)"
```

All four should print without errors. NumPy version must be `1.x.x`.

### 5. Add Reference Photos

Create a `known_faces/` folder and add one clear, front-facing photo per student. Name each file by the student's ID:

```
known_faces/
├── S0001.jpg
├── S0002.jpg
└── S0003.jpg
```

### 6. Start the Server

```bash
npm start
```

Open your browser at **http://localhost:3000**

---

## 🖥️ How to Use

1. **Upload** — drag and drop or select a classroom photo
2. **Analyse** — click "Analyse Photo" to run face recognition
3. **Review** — check or uncheck detected students (remove false positives)
4. **Confirm** — click "Confirm Attendance" to save to the database

---

## 🔌 API Endpoints

### `POST /api/upload-attendance`
Accepts a classroom photo, runs face recognition, returns detected student IDs.

**Request:** `multipart/form-data` with field `photo` (JPEG, PNG, or WEBP, max 10MB)

**Response:**
```json
{
  "detected":   ["S0001", "S0002"],
  "unknown":    1,
  "totalFaces": 3
}
```

---

### `POST /api/confirm-attendance`
Saves the verified attendance list to the SQLite database.

**Request:**
```json
{ "presentStudentIds": ["S0001", "S0002"] }
```

**Response:**
```json
{
  "message":   "Attendance confirmed and saved to database.",
  "count":     2,
  "timestamp": "2025-01-15T09:30:00.000Z"
}
```

---

### `GET /api/attendance`
Retrieves saved attendance records. Supports query filters.

| Query Param | Description | Example |
|---|---|---|
| *(none)* | All records | `/api/attendance` |
| `prefix` | IDs starting with value | `/api/attendance?prefix=CSE3` |
| `student_id` | Exact student ID match | `/api/attendance?student_id=CSE3001` |
| `date` | Filter by date (YYYY-MM-DD) | `/api/attendance?date=2025-01-15` |
| `prefix` + `date` | Combined filter | `/api/attendance?prefix=CSE3&date=2025-01-15` |

**Response:**
```json
{
  "count": 2,
  "records": [
    { "id": 1, "student_id": "S0001", "timestamp": "2025-01-15T09:30:00.000Z" },
    { "id": 2, "student_id": "S0002", "timestamp": "2025-01-15T09:30:00.000Z" }
  ]
}
```

---

## 🛠️ How It Works

```
Browser
  │
  │  POST /api/upload-attendance (image)
  ▼
Express (server.js)
  │  multer saves image to uploads/
  │  child_process.spawn("python", ["process_faces.py", imagePath])
  ▼
Python (process_faces.py)
  │  Loads classroom image → converts to RGB
  │  Detects faces → encodes each face
  │  Compares against known_faces/ encodings
  │  Prints JSON result to stdout
  ▼
Express reads stdout → sends JSON to browser
  │
  │  User reviews detected students in browser
  │
  │  POST /api/confirm-attendance
  ▼
Express saves records to attendance.db (SQLite)
```

---

## 🐛 Troubleshooting

### `Failed to build dlib`
Download a pre-built `.whl` from [github.com/z-mahmud22/Dlib_Windows_Python3.x](https://github.com/z-mahmud22/Dlib_Windows_Python3.x) matching your Python version and install it:
```bash
pip install dlib-19.24.1-cp310-cp310-win_amd64.whl
```

### `Please install face_recognition_models`
```bash
python -m pip install git+https://github.com/ageitgey/face_recognition_models
```

### `Unsupported image type, must be 8bit gray or RGB image`
NumPy 2.x is incompatible with dlib. Downgrade:
```bash
pip install "numpy<2" --force-reinstall
pip install face_recognition
```

### `Could not find valid JSON in stdout`
The Python script is printing non-JSON output. Run it directly to see the error:
```bash
python process_faces.py uploads/your-image.jpg
```

### `python is not recognized`
Python is not added to PATH. Reinstall Python 3.10 from [python.org](https://www.python.org/downloads/release/python-31011/) and check **"Add Python to PATH"** during installation.

---
// Shrawan Chakravarthy is a fool.
## 📦 Dependencies

### Node.js
| Package | Purpose |
|---|---|
| `express` | Web server and REST API |
| `multer` | Image file upload handling |
| `better-sqlite3` | SQLite database |

### Python
| Package | Purpose |
|---|---|
| `face_recognition` | Face detection and recognition |
| `face_recognition_models` | Pre-trained model weights |
| `dlib` | Face landmark detection (used by face_recognition) |
| `numpy (<2.0)` | Array operations |
| `opencv-python` | Image processing |
| `pillow` | Image format conversion (RGBA → RGB) |

