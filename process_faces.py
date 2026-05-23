"""
process_faces.py — Smart Attendance System Face Recognition Script
==================================================================
Called by server.js via child_process.spawn.
Usage:  python process_faces.py <image_path>
Output: A single JSON object printed to stdout.

Dependencies (Python 3.10 recommended):
    pip install cmake dlib face_recognition numpy opencv-python pillow
    python -m pip install git+https://github.com/ageitgey/face_recognition_models
"""

import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")


# ── respond() and log() first — always available even if imports fail ──────────

def respond(payload: dict, code: int = 0):
    """Only function that writes to stdout — guarantees clean JSON for Node."""
    try:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"[py] CRITICAL: respond() failed: {e}\n")
    sys.exit(code)


def log(msg: str):
    """Always writes to stderr — never pollutes stdout."""
    sys.stderr.write(f"[py] {msg}\n")
    sys.stderr.flush()


# ── Imports ───────────────────────────────────────────────────────────────────

log("Importing libraries...")

try:
    import numpy as np
    log(f"numpy {np.__version__} OK")
except ImportError as e:
    respond({"error": f"numpy not installed. Run: pip install numpy"}, code=1)

try:
    from PIL import Image
    log("Pillow OK")
except ImportError:
    respond({"error": "Pillow not installed. Run: pip install pillow"}, code=1)

try:
    import face_recognition
    log("face_recognition OK")
except ImportError as e:
    respond({"error": "face_recognition not installed. Run: pip install face_recognition"}, code=1)

try:
    import face_recognition_models
    log("face_recognition_models OK")
except ImportError:
    respond({
        "error": (
            "face_recognition_models not installed. "
            "Run: python -m pip install git+https://github.com/ageitgey/face_recognition_models"
        )
    }, code=1)


# ── Configuration ─────────────────────────────────────────────────────────────

KNOWN_FACES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "known_faces")
TOLERANCE       = 0.5


# ── Image Loader — converts ANY format to RGB numpy array ─────────────────────

def load_image_as_rgb(image_path: str) -> np.ndarray:
    """
    Loads an image using Pillow and converts it to an 8-bit RGB numpy array.
    Handles all common formats: RGBA (PNG), CMYK, grayscale, WEBP, etc.
    face_recognition requires exactly this format.
    """
    img = Image.open(image_path)

    log(f"Original image mode: {img.mode}, size: {img.size}")

    # Convert palette images (GIF, some PNGs) to RGBA first
    if img.mode == "P":
        img = img.convert("RGBA")

    # Convert RGBA / LA (transparency) → RGB by compositing onto white background
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "LA":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[3])   # use alpha channel as mask
        img = background
        log("Converted RGBA → RGB (white background)")

    # Convert any other mode (CMYK, L, YCbCr, etc.) directly to RGB
    if img.mode != "RGB":
        img = img.convert("RGB")
        log(f"Converted {img.mode} → RGB")

    rgb_array = np.ascontiguousarray(np.array(img, dtype=np.uint8))
    log(f"Final array shape: {rgb_array.shape}, dtype: {rgb_array.dtype}")
    return rgb_array


# ── Load Known Faces ──────────────────────────────────────────────────────────

def load_known_faces(directory: str):
    """
    Reads every image in `directory`, encodes the face, maps to the file stem
    (= student ID). Returns (encodings_list, student_ids_list).
    """
    encodings   = []
    student_ids = []

    if not os.path.isdir(directory):
        log(f"WARNING: known_faces/ not found at: {directory}")
        return encodings, student_ids

    image_files = [
        f for f in sorted(os.listdir(directory))
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]

    if not image_files:
        log("WARNING: known_faces/ is empty — add reference photos.")
        return encodings, student_ids

    for filename in image_files:
        student_id = os.path.splitext(filename)[0]
        img_path   = os.path.join(directory, filename)

        try:
            image = load_image_as_rgb(img_path)       # always RGB
            found = face_recognition.face_encodings(image)

            if found:
                encodings.append(found[0])
                student_ids.append(student_id)
                log(f"Loaded reference: {student_id}")
            else:
                log(f"WARNING: No face in reference image '{filename}' — skipping.")

        except Exception as e:
            log(f"ERROR loading '{filename}': {e}")

    log(f"Known faces loaded: {len(encodings)}")
    return encodings, student_ids


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log(f"Script started. Args: {sys.argv}")

    if len(sys.argv) < 2:
        respond({"error": "No image path provided. Usage: python process_faces.py <image_path>"}, code=1)

    image_path = sys.argv[1]
    log(f"Image path: {image_path}")

    if not os.path.isfile(image_path):
        respond({"error": f"Image file not found: {image_path}"}, code=1)

    # ── Load and convert classroom photo to RGB ───────────────────────────────
    try:
        log("Loading and converting classroom image to RGB...")
        classroom_image = load_image_as_rgb(image_path)

        log("Encoding faces in classroom image...")
        unknown_encodings = face_recognition.face_encodings(classroom_image)

    except Exception as e:
        respond({"error": f"Failed to process image: {str(e)}"}, code=1)

    total_faces = len(unknown_encodings)
    log(f"Faces detected: {total_faces}")

    if total_faces == 0:
        respond({
            "detected":   [],
            "unknown":    0,
            "totalFaces": 0,
            "message":    "No faces were detected in the uploaded image."
        })

    # ── Load reference faces ──────────────────────────────────────────────────
    log("Loading known faces...")
    known_encodings, known_ids = load_known_faces(KNOWN_FACES_DIR)

    detected_ids  = []
    unknown_count = 0

    # ── Match each face ───────────────────────────────────────────────────────
    for i, encoding in enumerate(unknown_encodings):
        log(f"Matching face {i + 1}/{total_faces}...")

        if not known_encodings:
            unknown_count += 1
            log("  No reference faces to compare against.")
            continue

        try:
            matches   = face_recognition.compare_faces(known_encodings, encoding, TOLERANCE)
            distances = face_recognition.face_distance(known_encodings, encoding)
            best      = int(np.argmin(distances))

            if matches[best]:
                sid = known_ids[best]
                if sid not in detected_ids:
                    detected_ids.append(sid)
                log(f"  Matched: {sid} (distance: {distances[best]:.4f})")
            else:
                unknown_count += 1
                log(f"  Unknown (closest distance: {distances[best]:.4f})")

        except Exception as e:
            log(f"  Match error for face {i + 1}: {e}")
            unknown_count += 1

    log(f"Done — detected: {detected_ids}, unknown: {unknown_count}, total: {total_faces}")

    respond({
        "detected":   detected_ids,
        "unknown":    unknown_count,
        "totalFaces": total_faces,
    })


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        respond({"error": f"Unhandled crash: {str(e)}"}, code=1)