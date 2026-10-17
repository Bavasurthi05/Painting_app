import json
import math
import re
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from flask import Flask, app, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from flask_cors import CORS

import os
import base64
from io import BytesIO

from dotenv import load_dotenv
from PIL import Image
from google import genai

from paint_color_analysis import (
    BERGER_DATASET_PATH,
    BergerDatasetError,
    analyze_house_image,
    get_paint_shade_catalogue,
)

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = (
    genai.Client(api_key=GEMINI_API_KEY)
    if GEMINI_API_KEY
    else None
)


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent / "paintwise.sqlite3"
VALID_PAINT_PRODUCTS = {
    "standard",
    "economy",
    "premium",
    "asianPaints",
    "berger",
    "nerolac",
    "dulux",
    "indigo",
    "nippon",
    "custom",
}
VALID_ATTENDANCE_STATUSES = {"present", "absent", "half-day"}
VALID_PROJECT_STATUSES = {"Not started", "In progress", "On hold", "Completed"}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _valid_measurement_value(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return False
    return not isinstance(value, float) or math.isfinite(value)


def _valid_optional_nonnegative_amount(value: Any) -> bool:
    if not _valid_measurement_value(value):
        return False
    if value == "":
        return True
    try:
        amount = float(value)
    except ValueError:
        return False
    return math.isfinite(amount) and amount >= 0


def _valid_rows(rows: Any, fields: set[str]) -> bool:
    if not isinstance(rows, list) or len(rows) > 500:
        return False

    for row in rows:
        if not isinstance(row, dict) or set(row) != fields:
            return False
        if not isinstance(row["id"], (str, int)) or isinstance(row["id"], bool):
            return False
        if not isinstance(row["name"], str) or len(row["name"]) > 120:
            return False
        if any(not _valid_measurement_value(row[field]) for field in fields - {"id", "name"}):
            return False
    return True


def _validate_measurements(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return "Request body must be a JSON object."

    if not _valid_rows(payload.get("walls"), {"id", "name", "length", "height"}):
        return "Walls must be a list of valid wall measurements."
    if not _valid_rows(
        payload.get("openings"),
        {"id", "name", "width", "height", "quantity"},
    ):
        return "Doors and windows must be a list of valid measurements."
    if not isinstance(payload.get("areaSource"), str) or payload["areaSource"] not in {
        "measurements",
        "manual",
    }:
        return "Area source is invalid."
    if payload.get("selectedPaintProduct") not in VALID_PAINT_PRODUCTS:
        return "Selected paint product is invalid."
    if not _valid_measurement_value(payload.get("paintableArea")):
        return "Paintable area must be text or a number."

    coats = payload.get("coats")
    coverage = payload.get("coverage")
    if (
        not isinstance(coats, (int, float))
        or isinstance(coats, bool)
        or not math.isfinite(coats)
        or coats <= 0
        or not isinstance(coverage, (int, float))
        or isinstance(coverage, bool)
        or not math.isfinite(coverage)
        or coverage <= 0
    ):
        return "Coats and coverage must be positive numbers."
    return None


def _validate_attendance(payload: Any, week_start: str) -> str | None:
    if not isinstance(payload, dict) or set(payload) != {"labourers"}:
        return "Attendance must include a labourers list."
    if not isinstance(payload["labourers"], list) or len(payload["labourers"]) > 100:
        return "Labourers must be a list with no more than 100 entries."

    try:
        from datetime import date, timedelta

        start_date = date.fromisoformat(week_start)
    except ValueError:
        return "Week start must be a valid ISO date."

    allowed_days = {
        (start_date + timedelta(days=offset)).isoformat() for offset in range(7)
    }
    seen_ids: set[str] = set()
    for labourer in payload["labourers"]:
        if (
            not isinstance(labourer, dict)
            or set(labourer)
            != {"id", "name", "dailyWage", "advance", "attendance"}
        ):
            return "Each labourer must include an ID, name, daily wage, advance, and attendance."
        labourer_id = labourer["id"]
        if not isinstance(labourer_id, (str, int)) or isinstance(labourer_id, bool):
            return "Labourer IDs must be text or integers."
        if str(labourer_id) in seen_ids:
            return "Labourer IDs must be unique within the week."
        seen_ids.add(str(labourer_id))
        if not isinstance(labourer["name"], str) or len(labourer["name"]) > 120:
            return "Labourer names must be text with at most 120 characters."
        if not _valid_measurement_value(labourer["dailyWage"]):
            return "Daily wages must be text or finite numbers."
        if not _valid_optional_nonnegative_amount(labourer["advance"]):
            return "Advance must be empty or a non-negative finite amount."
        if not isinstance(labourer["attendance"], dict):
            return "Attendance entries must be an object keyed by ISO date."
        if any(
            not isinstance(day, str)
            or not isinstance(status, str)
            or day not in allowed_days
            or status not in VALID_ATTENDANCE_STATUSES
            for day, status in labourer["attendance"].items()
        ):
            return "Attendance entries must use this week's dates and valid statuses."
    return None


def _normalize_uuid(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def _project_record(row: sqlite3.Row) -> dict[str, str]:
    return {
        "id": row["project_id"],
        "name": row["name"],
        "customerName": row["customer_name"],
        "location": row["location"],
        "deadline": row["deadline"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "imageData": row["image_data"] if "image_data" in row.keys() else "",
    }


def _validate_project(payload: Any) -> str | None:
    fields = {"name", "customerName", "location", "deadline", "status"}
    if not isinstance(payload, dict) or set(payload) != fields:
        return "Project details must include a name, customer, location, deadline, and status."
    limits = {"name": 120, "customerName": 120, "location": 240, "deadline": 10}
    for field, limit in limits.items():
        value = payload[field]
        if not isinstance(value, str) or len(value) > limit:
            return f"{field} must be text with at most {limit} characters."
    if not payload["name"].strip():
        return "Project name is required."
    if (
        not isinstance(payload["status"], str)
        or payload["status"] not in VALID_PROJECT_STATUSES
    ):
        return "Project status is invalid."
    if payload["deadline"] and not DATE_PATTERN.fullmatch(payload["deadline"]):
        return "Deadline must use YYYY-MM-DD format."
    if payload["deadline"]:
        try:
            from datetime import date
            date.fromisoformat(payload["deadline"])
        except ValueError:
            return "Deadline must be a valid date."
    return None


def _validate_project_data(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return "Project data must be a JSON object."
    if "quotationAmount" in payload:
        amount = payload["quotationAmount"]
        if (
            isinstance(amount, bool)
            or not isinstance(amount, (int, float))
            or not math.isfinite(amount)
            or amount < 0
        ):
            return "Quotation amount must be a non-negative finite number."
    for record_type in ("expenses", "payments"):
        records = payload.get(record_type, [])
        if not isinstance(records, list) or len(records) > 10000:
            return f"{record_type.title()} must be a list."
        for record in records:
            if (
                not isinstance(record, dict)
                or set(record) != {"id", "date", "description", "amount"}
                or not isinstance(record["id"], str)
                or not isinstance(record["date"], str)
                or not DATE_PATTERN.fullmatch(record["date"])
                or not isinstance(record["description"], str)
                or len(record["description"]) > 200
                or isinstance(record["amount"], bool)
                or not isinstance(record["amount"], (int, float))
                or not math.isfinite(record["amount"])
                or record["amount"] < 0
            ):
                return f"Each {record_type[:-1]} must have a valid date, description, and non-negative amount."
            try:
                from datetime import date
                date.fromisoformat(record["date"])
            except ValueError:
                return f"Each {record_type[:-1]} must have a valid date."
    return None


@contextmanager
def _connect(database_path: str) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)

    app.config.from_mapping(
        DATABASE=str(DEFAULT_DATABASE_PATH),
        MAX_CONTENT_LENGTH=12 * 1024 * 1024,  # 12 MB
        BERGER_SHADE_DATASET=str(BERGER_DATASET_PATH),
    )

    if test_config:
        app.config.update(test_config)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_too_large(_: RequestEntityTooLarge) -> tuple[Any, int]:
        return jsonify({"error": "Upload must be smaller than 10 MB."}), 413

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": [
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                ]
            }
        },
    )

    database_path = Path(app.config["DATABASE"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(str(database_path)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS painting_measurements (
                project_id TEXT PRIMARY KEY,
                measurements_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS labour_weekly_attendance (
                project_id TEXT NOT NULL,
                week_start TEXT NOT NULL,
                attendance_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, week_start)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS painting_projects (
                project_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                name TEXT NOT NULL,
                customer_name TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                deadline TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Not started',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_painting_projects_workspace
            ON painting_projects (workspace_id, created_at)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS painting_project_data (
                project_id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES painting_projects(project_id)
            )
            """
        )

    @app.get("/api/health")
    def health() -> tuple[Any, int]:
        return jsonify({"status": "ok"}), 200

    @app.get("/api/paint-shades/<brand>")
    def paint_shade_catalogue(brand: str) -> tuple[Any, int]:
        normalized_brand = brand.strip().lower()
        if normalized_brand not in {"berger", "asian", "nerolac", "dulux"}:
            return jsonify({"error": "Unsupported paint brand."}), 400
        try:
            catalogue = get_paint_shade_catalogue(
                normalized_brand,
                Path(app.config["BERGER_SHADE_DATASET"]),
            )
        except BergerDatasetError:
            app.logger.exception("Configured Berger shade dataset is invalid")
            return jsonify({"error": "The configured Berger shade dataset is invalid."}), 500
        return jsonify(catalogue), 200

    @app.post("/api/paint-colour-analysis")
    def analyze_painted_house() -> tuple[Any, int]:
        uploaded_file = request.files.get("image")
        if uploaded_file is None:
            return jsonify({"error": "Please upload a house photo."}), 400
        if uploaded_file.mimetype not in {
            "image/jpeg",
            "image/png",
            "image/webp",
        }:
            return jsonify({"error": "Upload a JPEG, PNG, or WebP house image."}), 400

        image_bytes = uploaded_file.stream.read(10 * 1024 * 1024 + 1)
        if not image_bytes:
            return jsonify({"error": "The uploaded image is empty."}), 400
        if len(image_bytes) > 10 * 1024 * 1024:
            return jsonify({"error": "Image must be smaller than 10 MB."}), 413

        mask_file = request.files.get("house_mask")
        if mask_file is None or mask_file.mimetype != "image/png":
            return jsonify(
                {"error": "A PNG house segmentation mask is required for colour analysis."}
            ), 400
        house_mask_bytes = mask_file.stream.read(2 * 1024 * 1024 + 1)
        if not house_mask_bytes:
            return jsonify({"error": "House segmentation mask is empty."}), 400
        if len(house_mask_bytes) > 2 * 1024 * 1024:
            return jsonify({"error": "House segmentation mask must be smaller than 2 MB."}), 413

        brand = request.form.get("brand", "")
        supported_brands = {"berger", "asian", "nerolac", "dulux"}
        if brand not in supported_brands:
            return jsonify({"error": "Choose a supported paint brand."}), 400

        try:
            shade_dataset = (
                Path(app.config["BERGER_SHADE_DATASET"])
                if brand == "berger"
                else None
            )
            result = analyze_house_image(
                image_bytes,
                shade_dataset,
                house_mask_bytes,
            )
            result["selected_brand"] = brand
            result["brand_catalogue_available"] = (
                brand == "berger" and result["berger_dataset_available"]
            )
            for region in result["regions"]:
                region["brand_match"] = (
                    region["berger_match"] if brand == "berger" else None
                )
            result["brand_match_message"] = (
                None
                if result["brand_catalogue_available"]
                else f"No verified {brand.title()} shade catalogue is configured; shade matches are unavailable."
            )
        except BergerDatasetError:
            app.logger.exception("Configured Berger shade dataset is invalid")
            return jsonify({"error": "The configured Berger shade dataset is invalid."}), 500
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except (OSError, Image.DecompressionBombError):
            return jsonify({"error": "The uploaded file is not a safe, readable image."}), 400
        except Exception:
            app.logger.exception("Painted-house colour analysis failed")
            return jsonify({"error": "Colour analysis failed. Check the Flask server logs."}), 500

        return jsonify(result), 200

    @app.get("/api/projects/<workspace_id>")
    def list_projects(workspace_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        if normalized_workspace_id is None:
            return jsonify({"error": "Workspace ID must be a UUID."}), 400

        with _connect(app.config["DATABASE"]) as connection:
            rows = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects
                WHERE workspace_id = ?
                ORDER BY created_at, project_id
                """,
                (normalized_workspace_id,),
            ).fetchall()
            if not rows:
                # The workspace UUID is also the legacy measurement/attendance key.
                # Reusing it for the first project keeps pre-project data intact.
                connection.execute(
                    """
                    INSERT OR IGNORE INTO painting_projects
                        (project_id, workspace_id, name, customer_name, location, deadline, status)
                    VALUES (?, ?, 'My First House', '', '', '', 'Not started')
                    """,
                    (normalized_workspace_id, normalized_workspace_id),
                )
                rows = connection.execute(
                    """
                    SELECT project_id, name, customer_name, location, deadline, status,
                           created_at, updated_at
                    FROM painting_projects
                    WHERE workspace_id = ?
                    ORDER BY created_at, project_id
                    """,
                    (normalized_workspace_id,),
                ).fetchall()
        return jsonify({"projects": [_project_record(row) for row in rows]}), 200

    @app.post("/api/projects/<workspace_id>")
    def create_project(workspace_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        if normalized_workspace_id is None:
            return jsonify({"error": "Workspace ID must be a UUID."}), 400
        payload = request.get_json()
        validation_error = _validate_project(payload)
        if validation_error:
            return jsonify({"error": validation_error}), 400

        project_id = str(uuid.uuid4())
        with _connect(app.config["DATABASE"]) as connection:
            connection.execute(
                """
                INSERT INTO painting_projects
                    (project_id, workspace_id, name, customer_name, location, deadline, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    normalized_workspace_id,
                    payload["name"].strip(),
                    payload["customerName"].strip(),
                    payload["location"].strip(),
                    payload["deadline"],
                    payload["status"],
                ),
            )
            row = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
        return jsonify({"project": _project_record(row)}), 201

    @app.put("/api/projects/<workspace_id>/<project_id>")
    def update_project(workspace_id: str, project_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        normalized_project_id = _normalize_uuid(project_id)
        if normalized_workspace_id is None or normalized_project_id is None:
            return jsonify({"error": "Workspace and project IDs must be UUIDs."}), 400
        payload = request.get_json()
        validation_error = _validate_project(payload)
        if validation_error:
            return jsonify({"error": validation_error}), 400

        with _connect(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                """
                UPDATE painting_projects
                SET name = ?, customer_name = ?, location = ?, deadline = ?, status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ? AND workspace_id = ?
                """,
                (
                    payload["name"].strip(),
                    payload["customerName"].strip(),
                    payload["location"].strip(),
                    payload["deadline"],
                    payload["status"],
                    normalized_project_id,
                    normalized_workspace_id,
                ),
            )
            if cursor.rowcount == 0:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            row = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects WHERE project_id = ?
                """,
                (normalized_project_id,),
            ).fetchone()
        return jsonify({"project": _project_record(row)}), 200

    @app.delete("/api/projects/<workspace_id>/<project_id>")
    def delete_project(workspace_id: str, project_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        normalized_project_id = _normalize_uuid(project_id)
        if normalized_workspace_id is None or normalized_project_id is None:
            return jsonify({"error": "Workspace and project IDs must be UUIDs."}), 400

        with _connect(app.config["DATABASE"]) as connection:
            project = connection.execute(
                """
                SELECT 1 FROM painting_projects
                WHERE project_id = ? AND workspace_id = ?
                """,
                (normalized_project_id, normalized_workspace_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404

            project_count = connection.execute(
                "SELECT COUNT(*) FROM painting_projects WHERE workspace_id = ?",
                (normalized_workspace_id,),
            ).fetchone()[0]
            if project_count <= 1:
                return jsonify({"error": "At least one house must remain in the workspace."}), 409

            connection.execute(
                "DELETE FROM labour_weekly_attendance WHERE project_id = ?",
                (normalized_project_id,),
            )
            connection.execute(
                "DELETE FROM painting_measurements WHERE project_id = ?",
                (normalized_project_id,),
            )
            connection.execute(
                "DELETE FROM painting_project_data WHERE project_id = ?",
                (normalized_project_id,),
            )
            connection.execute(
                "DELETE FROM painting_projects WHERE project_id = ? AND workspace_id = ?",
                (normalized_project_id, normalized_workspace_id),
            )
        return jsonify({"deleted": True}), 200

    @app.get("/api/projects/<workspace_id>/<project_id>/data")
    def get_project_data(workspace_id: str, project_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        normalized_project_id = _normalize_uuid(project_id)
        if normalized_workspace_id is None or normalized_project_id is None:
            return jsonify({"error": "Workspace and project IDs must be UUIDs."}), 400
        with _connect(app.config["DATABASE"]) as connection:
            project = connection.execute(
                """
                SELECT 1 FROM painting_projects
                WHERE project_id = ? AND workspace_id = ?
                """,
                (normalized_project_id, normalized_workspace_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            row = connection.execute(
                "SELECT data_json FROM painting_project_data WHERE project_id = ?",
                (normalized_project_id,),
            ).fetchone()
        return jsonify({"data": json.loads(row["data_json"]) if row else None}), 200

    @app.put("/api/projects/<workspace_id>/<project_id>/data")
    def save_project_data(workspace_id: str, project_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        normalized_project_id = _normalize_uuid(project_id)
        if normalized_workspace_id is None or normalized_project_id is None:
            return jsonify({"error": "Workspace and project IDs must be UUIDs."}), 400
        payload = request.get_json()
        validation_error = _validate_project_data(payload)
        if validation_error:
            return jsonify({"error": validation_error}), 400
        with _connect(app.config["DATABASE"]) as connection:
            project = connection.execute(
                """
                SELECT 1 FROM painting_projects
                WHERE project_id = ? AND workspace_id = ?
                """,
                (normalized_project_id, normalized_workspace_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            connection.execute(
                """
                INSERT INTO painting_project_data (project_id, data_json)
                VALUES (?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    data_json = excluded.data_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (normalized_project_id, json.dumps(payload, separators=(",", ":"))),
            )
        return jsonify({"saved": True}), 200

    @app.get("/api/projects/<workspace_id>/summary")
    def project_summary(workspace_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        if normalized_workspace_id is None:
            return jsonify({"error": "Workspace ID must be a UUID."}), 400
        with _connect(app.config["DATABASE"]) as connection:
            rows = connection.execute(
                """
                SELECT p.project_id, p.name, p.status, d.data_json
                FROM painting_projects AS p
                LEFT JOIN painting_project_data AS d ON d.project_id = p.project_id
                WHERE p.workspace_id = ?
                ORDER BY p.created_at, p.project_id
                """,
                (normalized_workspace_id,),
            ).fetchall()

        summaries = []
        for row in rows:
            project_data = json.loads(row["data_json"]) if row["data_json"] else {}
            expenses = project_data.get("expenses", [])
            payments = project_data.get("payments", [])
            quotation = project_data.get("quotationAmount", 0)
            expense_total = sum(float(item["amount"]) for item in expenses)
            payment_total = sum(float(item["amount"]) for item in payments)
            summaries.append(
                {
                    "id": row["project_id"],
                    "name": row["name"],
                    "status": row["status"],
                    "quotationAmount": quotation,
                    "expenses": expense_total,
                    "payments": payment_total,
                    "outstanding": quotation - payment_total,
                }
            )
        return jsonify({"projects": summaries}), 200

    @app.get("/api/projects/<workspace_id>/<project_id>/export")
    def export_project(workspace_id: str, project_id: str) -> tuple[Any, int]:
        normalized_workspace_id = _normalize_uuid(workspace_id)
        normalized_project_id = _normalize_uuid(project_id)
        if normalized_workspace_id is None or normalized_project_id is None:
            return jsonify({"error": "Workspace and project IDs must be UUIDs."}), 400
        with _connect(app.config["DATABASE"]) as connection:
            project = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects
                WHERE project_id = ? AND workspace_id = ?
                """,
                (normalized_project_id, normalized_workspace_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            measurement = connection.execute(
                "SELECT measurements_json FROM painting_measurements WHERE project_id = ?",
                (normalized_project_id,),
            ).fetchone()
            project_data = connection.execute(
                "SELECT data_json FROM painting_project_data WHERE project_id = ?",
                (normalized_project_id,),
            ).fetchone()
            attendance_rows = connection.execute(
                """
                SELECT week_start, attendance_json, updated_at
                FROM labour_weekly_attendance WHERE project_id = ?
                ORDER BY week_start
                """,
                (normalized_project_id,),
            ).fetchall()
        return (
            jsonify(
                {
                    "project": _project_record(project),
                    "measurements": json.loads(measurement["measurements_json"])
                    if measurement
                    else None,
                    "projectData": json.loads(project_data["data_json"])
                    if project_data
                    else None,
                    "attendance": [
                        {
                            "weekStart": row["week_start"],
                            **json.loads(row["attendance_json"]),
                            "updatedAt": row["updated_at"],
                        }
                        for row in attendance_rows
                    ],
                }
            ),
            200,
        )

    @app.get("/api/measurements/<project_id>")
    def get_measurements(project_id: str) -> tuple[Any, int]:
        try:
            normalized_project_id = str(uuid.UUID(project_id))
        except ValueError:
            return jsonify({"error": "Project ID must be a UUID."}), 400

        with _connect(app.config["DATABASE"]) as connection:
            row = connection.execute(
                """
                SELECT measurements_json, updated_at
                FROM painting_measurements
                WHERE project_id = ?
                """,
                (normalized_project_id,),
            ).fetchone()
        if row is None:
            return jsonify({"measurements": None}), 200
        return (
            jsonify(
                {
                    "measurements": json.loads(row["measurements_json"]),
                    "updatedAt": row["updated_at"],
                }
            ),
            200,
        )

    @app.put("/api/measurements/<project_id>")
    def save_measurements(project_id: str) -> tuple[Any, int]:
        try:
            normalized_project_id = str(uuid.UUID(project_id))
        except ValueError:
            return jsonify({"error": "Project ID must be a UUID."}), 400

        payload = request.get_json()
        validation_error = _validate_measurements(payload)
        if validation_error:
            return jsonify({"error": validation_error}), 400

        serialized_measurements = json.dumps(payload, separators=(",", ":"))
        with _connect(app.config["DATABASE"]) as connection:
            connection.execute(
                """
                INSERT INTO painting_measurements (project_id, measurements_json)
                VALUES (?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    measurements_json = excluded.measurements_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (normalized_project_id, serialized_measurements),
            )
        return jsonify({"saved": True}), 200

    @app.get("/api/attendance/<project_id>")
    def get_attendance(project_id: str) -> tuple[Any, int]:
        try:
            normalized_project_id = str(uuid.UUID(project_id))
        except ValueError:
            return jsonify({"error": "Project ID must be a UUID."}), 400

        week_start = request.args.get("week_start", "")
        if not DATE_PATTERN.fullmatch(week_start):
            return jsonify({"error": "Week start must use YYYY-MM-DD format."}), 400
        validation_error = _validate_attendance({"labourers": []}, week_start)
        if validation_error:
            return jsonify({"error": validation_error}), 400

        with _connect(app.config["DATABASE"]) as connection:
            row = connection.execute(
                """
                SELECT attendance_json, updated_at
                FROM labour_weekly_attendance
                WHERE project_id = ? AND week_start = ?
                """,
                (normalized_project_id, week_start),
            ).fetchone()
        if row is None:
            return jsonify({"attendance": None}), 200
        return (
            jsonify(
                {
                    "attendance": json.loads(row["attendance_json"]),
                    "updatedAt": row["updated_at"],
                }
            ),
            200,
        )

    @app.put("/api/attendance/<project_id>")
    def save_attendance(project_id: str) -> tuple[Any, int]:
        try:
            normalized_project_id = str(uuid.UUID(project_id))
        except ValueError:
            return jsonify({"error": "Project ID must be a UUID."}), 400

        payload = request.get_json()
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400
        week_start = payload.get("weekStart")
        if not isinstance(week_start, str) or not DATE_PATTERN.fullmatch(week_start):
            return jsonify({"error": "Week start must use YYYY-MM-DD format."}), 400
        validation_error = _validate_attendance(
            {"labourers": payload.get("labourers")}, week_start
        )
        if validation_error:
            return jsonify({"error": validation_error}), 400

        serialized_attendance = json.dumps(
            {"labourers": payload["labourers"]}, separators=(",", ":")
        )
        with _connect(app.config["DATABASE"]) as connection:
            connection.execute(
                """
                INSERT INTO labour_weekly_attendance
                    (project_id, week_start, attendance_json)
                VALUES (?, ?, ?)
                ON CONFLICT(project_id, week_start) DO UPDATE SET
                    attendance_json = excluded.attendance_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (normalized_project_id, week_start, serialized_attendance),
            )
        return jsonify({"saved": True}), 200
    
    
    
    @app.post("/api/home-design/preview")
    def generate_home_design_preview():
        import requests
        import base64

        api_key = os.getenv("STABILITY_API_KEY")

        if not api_key:
            return jsonify({
                "error": "Stability AI API key is missing"
            }), 500

        uploaded_file = request.files.get("image")

        if not uploaded_file:
            return jsonify({
                "error": "Please upload a house photo"
            }), 400

        wall_color = request.form.get(
            "wall_color", "#E8D7B5"
        )
        trim_color = request.form.get(
            "trim_color", "#79513A"
        )
        wall_color_name = request.form.get(
            "wall_color_name", "specified wall color"
        ).strip()
        trim_color_name = request.form.get(
            "trim_color_name", "specified trim color"
        ).strip()

        if any(
            not name
            or len(name) > 40
            or not all(character.isalpha() or character in " -" for character in name)
            for name in (wall_color_name, trim_color_name)
        ):
            return jsonify({
                "error": "Color names must contain only letters, spaces, or hyphens"
            }), 400

        try:
            image_bytes = uploaded_file.read()

            if (
                not image_bytes
                or len(image_bytes) > 10 * 1024 * 1024
            ):
                return jsonify({
                    "error": "Image must be under 10 MB"
                }), 400

            # Validate and resize the original photo.
            with Image.open(BytesIO(image_bytes)) as original:
                original = original.convert("RGB")
                original.thumbnail(
                    (1024, 768),
                    Image.Resampling.LANCZOS
                )

                canvas = Image.new("RGB", (1024, 768), (255, 255, 255))

                original.thumbnail((1024, 768), Image.Resampling.LANCZOS)

                x = (1024 - original.width) // 2
                y = (768 - original.height) // 2

                canvas.paste(original, (x, y))

                buffer = BytesIO()
                canvas.save(buffer, format="PNG")
                image_bytes = buffer.getvalue()

            prompt = f"""
IMAGE EDITING TASK — REPAINT THE EXISTING HOUSE PHOTO.

Use the uploaded photograph as the exact base image.
This is a paint-color visualization, NOT a house redesign.

WALL COLOR: {wall_color_name} ({wall_color})
TRIM COLOR: {trim_color_name} ({trim_color})

Repaint the exterior walls in the named wall color. The color name and
hex code are both required: match the hue and saturation rather than
using the hex value as a subtle tint. Paint must look visibly pink,
purple, green, blue, yellow, or brown as named, not white, cream, gray,
or pale pastel. Keep the wall and trim colors distinct and preserve
natural shadows and lighting without washing out the colors.

Apply the wall color uniformly to ALL visible exterior painted
wall surfaces, including upper walls, side walls, and the
recessed entrance walls.

Apply the trim color to existing painted borders, columns,
fascia, exterior bands, and other trim surfaces.

STRICT REQUIREMENTS:
- Preserve the exact original photograph and camera angle.
- Keep every wall, window, door, roof, column, and step
  in its original position, shape, and size.
- Preserve the original background, trees, ground, and shadows.
- Do not create a new house or add architectural features.
- Do not change the image composition or crop the house.
- Do not leave large exterior wall sections unpainted.
- Show a realistic paint finish with natural lighting.
- Make the new paint colors clearly visible and match the specified
  names and hex codes; do not render white or near-white walls.
- Only change the paint colors of existing exterior surfaces.
"""

            response = requests.post(
    "https://api.stability.ai/v1/generation/"
    "stable-diffusion-xl-1024-v1-0/image-to-image",

    headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    },

    files={
        "init_image": (
            "house.png",
            image_bytes,
            "image/png",
        )
    },

    data={
        "text_prompts[0][text]": prompt,
        "text_prompts[0][weight]": 1,
        "text_prompts[1][text]": (
            "changed architecture, distorted windows, "
            "changed roof, blurry, unrealistic, washed-out colors, "
            "desaturated paint, pale pastel walls, white walls"
        ),
        "text_prompts[1][weight]": -1,
        "init_image_mode": "IMAGE_STRENGTH",
        "image_strength": 0.45,
        "cfg_scale": 8,
        "steps": 30,
        "samples": 1,
    },

    timeout=180,
)

            if not response.ok:
                app.logger.error(
                    "Stability AI error %s: %s",
                    response.status_code,
                    response.text[:1000],
                )
                return jsonify({
                    "error": "Stability AI request failed",
                    "details": response.text[:500],
                }), 502

            result = response.json()
            artifacts = result.get("artifacts", [])

            if not artifacts or not artifacts[0].get("base64"):
                return jsonify({
                    "error": "Stability AI returned no image"
                }), 502

            image_base64 = artifacts[0]["base64"]

            return jsonify({
                "image": (
                    f"data:image/png;base64,{image_base64}"
                )
            }), 200

        except Exception:
            app.logger.exception(
                "Stability AI home-design preview failed"
            )
            return jsonify({
                "error": "Image preview failed. Check Flask terminal."
            }), 500

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
