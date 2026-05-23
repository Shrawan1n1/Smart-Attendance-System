/**
 * app.js — Smart Attendance System Frontend
 * Handles: file selection, drag-and-drop, upload, result review, confirmation.
 */

// ── DOM References ────────────────────────────────────────────────────────────

const dropZone       = document.getElementById("drop-zone");
const fileInput      = document.getElementById("file-input");
const fileNameLabel  = document.getElementById("file-name");
const preview        = document.getElementById("preview");
const uploadBtn      = document.getElementById("upload-btn");

const uploadSection    = document.getElementById("upload-section");
const resultsSection   = document.getElementById("results-section");
const confirmedSection = document.getElementById("confirmed-section");

const studentList       = document.getElementById("student-list");
const detectionSummary  = document.getElementById("detection-summary");
const confirmBtn        = document.getElementById("confirm-btn");
const confirmedSummary  = document.getElementById("confirmed-summary");
const resetBtn          = document.getElementById("reset-btn");

const loader   = document.getElementById("loader");
const errorMsg = document.getElementById("error-msg");

// ── State ─────────────────────────────────────────────────────────────────────

let selectedFile = null;

// ── File Selection Helpers ────────────────────────────────────────────────────

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showError("Please select a valid image file.");
    return;
  }

  selectedFile = file;
  fileNameLabel.textContent = file.name;

  // Show inline preview
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);

  uploadBtn.disabled = false;
  hideError();
}

// Click on drop zone → trigger hidden file input
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

// Drag-and-drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

// ── Step 1 — Upload & Analyse ─────────────────────────────────────────────────

uploadBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  setLoading(true);
  hideError();

  const formData = new FormData();
  formData.append("photo", selectedFile);

  try {
    const response = await fetch("/api/upload-attendance", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

// ── Step 2 — Render Detection Results ────────────────────────────────────────

/**
 * @param {{ detected: string[], unknown: number, totalFaces: number }} data
 */
function renderResults(data) {
  const { detected = [], unknown = 0, totalFaces = 0 } = data;

  detectionSummary.textContent =
    `${totalFaces} face(s) found — ${detected.length} identified, ${unknown} unknown.`;

  studentList.innerHTML = "";

  if (detected.length === 0) {
    studentList.innerHTML = "<li style='color:#a0aec0'>No students could be identified.</li>";
  } else {
    detected.forEach((id) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <input type="checkbox" id="chk-${id}" value="${id}" checked />
        <label for="chk-${id}">Student ID: <strong>${id}</strong></label>
      `;
      studentList.appendChild(li);
    });
  }

  uploadSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");
}

// ── Step 3 — Confirm Attendance ───────────────────────────────────────────────

confirmBtn.addEventListener("click", async () => {
  // Collect only checked IDs (user may have unchecked false positives)
  const checkedBoxes = studentList.querySelectorAll("input[type='checkbox']:checked");
  const presentStudentIds = Array.from(checkedBoxes).map((cb) => cb.value);

  setLoading(true);
  hideError();

  try {
    const response = await fetch("/api/confirm-attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentStudentIds }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Confirmation failed.");
    }

    confirmedSummary.textContent =
      `${data.count} student(s) marked present at ${new Date(data.timestamp).toLocaleTimeString()}.`;

    resultsSection.classList.add("hidden");
    confirmedSection.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

// ── Reset ─────────────────────────────────────────────────────────────────────

resetBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileNameLabel.textContent = "No file selected";
  preview.src = "";
  preview.classList.add("hidden");
  uploadBtn.disabled = true;
  studentList.innerHTML = "";

  confirmedSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  hideError();
});

// ── Utility ───────────────────────────────────────────────────────────────────

function setLoading(on) {
  loader.classList.toggle("hidden", !on);
  uploadBtn.disabled = on;
  confirmBtn.disabled = on;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}

function hideError() {
  errorMsg.classList.add("hidden");
  errorMsg.textContent = "";
}