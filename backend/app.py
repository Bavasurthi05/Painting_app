import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import smtplib
import sqlite3
import time
import uuid
from contextlib import contextmanager
from email.message import EmailMessage
from io import BytesIO
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlencode

import cv2
import httpx
import numpy as np
from dotenv import load_dotenv
from flask import Flask, g, jsonify, redirect, request
from google import genai
from google.genai import types
from google.genai.errors import APIError
from werkzeug.exceptions import RequestEntityTooLarge
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from PIL import Image, ImageOps

from paint_color_analysis import (
    BERGER_DATASET_PATH,
    BergerDatasetError,
    analyze_house_image,
    get_paint_shade_catalogue,
)

load_dotenv(Path(__file__).resolve().parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent / "paintwise.sqlite3"
MAX_CHAT_MESSAGE_LENGTH = 2_000
MAX_CHAT_HISTORY_MESSAGES = 20
MAX_CHAT_HISTORY_ITEM_LENGTH = 4_000
MAX_CHAT_REQUEST_BYTES = 100_000
CHAT_SYSTEM_INSTRUCTION = """You are the helpful Painting Contractor Assistant in the PaintWise app.
Answer general knowledge, painting, colour and design, material, estimating,
contractor planning, app-feature, programming, and everyday questions clearly.
Use conversation context for follow-ups and account for likely spelling mistakes.
Give steps when useful and ask concise clarifying questions when details are
missing. For estimates, do not invent measurements, quotations, local prices, or
saved customer/project details; ask for dimensions, location, paint brand,
coverage, coats, and other relevant inputs. You do not have access to this
user's saved project data, and must never claim that you do. The app's known
features include house projects, measurements, quotations, costs, expenses,
payments, labour attendance, project backups, paint shade catalogues, and
paint-colour analysis/design previews. Do not claim features beyond these.
There is no live web search; be transparent when information may be out of date.
Be friendly, accurate, and straightforward."""
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


def _gemini_retry_after_seconds(error: APIError) -> int | None:
    details = error.details
    if not isinstance(details, dict):
        return None

    error_details = details.get("error", details)
    if not isinstance(error_details, dict):
        return None
    provider_details = error_details.get("details", [])
    if not isinstance(provider_details, list):
        return None

    for detail in provider_details:
        if not isinstance(detail, dict) or not str(
            detail.get("@type", "")
        ).endswith("RetryInfo"):
            continue
        retry_delay = detail.get("retryDelay", "")
        match = re.fullmatch(r"(\d+(?:\.\d+)?)s", retry_delay)
        if match:
            return max(1, math.ceil(float(match.group(1))))
    return None


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


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _valid_password(password: Any) -> bool:
    return (
        isinstance(password, str)
        and 8 <= len(password) <= 256
        and any(character.isupper() for character in password)
        and any(character.islower() for character in password)
        and any(character.isdigit() for character in password)
    )


def _valid_auth_origin(origin: str | None, allowed_origins: list[str]) -> bool:
    return origin is not None and origin in allowed_origins


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
        DATABASE=os.getenv("DATABASE", str(DEFAULT_DATABASE_PATH)),
        MAX_CONTENT_LENGTH=18 * 1024 * 1024,  # image plus three bounded PNG masks
        BERGER_SHADE_DATASET=str(BERGER_DATASET_PATH),
        AUTH_COOKIE_NAME="paintwise_session",
        AUTH_COOKIE_SECURE=os.getenv("AUTH_COOKIE_SECURE", "false").lower()
        in {"1", "true", "yes"},
        AUTH_COOKIE_SAMESITE=os.getenv("AUTH_COOKIE_SAMESITE", "Lax"),
        AUTH_SESSION_TTL_SECONDS=60 * 60 * 24 * 14,
        AUTH_ALLOWED_ORIGINS=[
            origin.strip()
            for origin in os.getenv(
                "AUTH_ALLOWED_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        ],
        FRONTEND_URL=os.getenv("FRONTEND_URL", "http://localhost:5173"),
        GOOGLE_CLIENT_ID=os.getenv("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET=os.getenv("GOOGLE_CLIENT_SECRET"),
        GOOGLE_REDIRECT_URI=os.getenv(
            "GOOGLE_REDIRECT_URI",
            "http://localhost:5173/api/auth/google/callback",
        ),
        SMTP_HOST=os.getenv("SMTP_HOST"),
        SMTP_PORT=int(os.getenv("SMTP_PORT", "587")),
        SMTP_USERNAME=os.getenv("SMTP_USERNAME"),
        SMTP_PASSWORD=os.getenv("SMTP_PASSWORD"),
        SMTP_FROM=os.getenv("SMTP_FROM"),
        GEMINI_API_KEY=os.getenv("GEMINI_API_KEY"),
        GEMINI_MODEL=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        GEMINI_IMAGE_MODEL=os.getenv(
            "GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"
        ),
        GEMINI_TIMEOUT_MS=30_000,
        GEMINI_IMAGE_TIMEOUT_MS=int(os.getenv("GEMINI_IMAGE_TIMEOUT_MS", "120000")),
    )

    if test_config:
        app.config.update(test_config)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_too_large(_: RequestEntityTooLarge) -> tuple[Any, int]:
        return jsonify(
            {
                "error": (
                    "Request is too large. House photos must be under 10 MB and "
                    "each paint mask under 2 MB."
                )
            }
        ), 413

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": app.config["AUTH_ALLOWED_ORIGINS"]
            }
        },
        supports_credentials=True,
    )

    database_path = Path(app.config["DATABASE"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(str(database_path)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                name TEXT NOT NULL,
                phone TEXT NOT NULL DEFAULT '',
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        user_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(users)")
        }
        if "phone" not in user_columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''"
            )
        if "created_at" not in user_columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"
            )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
            ON auth_sessions (user_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS google_oauth_states (
                state_hash TEXT PRIMARY KEY,
                nonce TEXT NOT NULL,
                code_verifier TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS painting_measurements (
                project_id TEXT PRIMARY KEY,
                measurements_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                user_id TEXT
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
                user_id TEXT,
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
                user_id TEXT,
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
                user_id TEXT,
                FOREIGN KEY (project_id) REFERENCES painting_projects(project_id)
            )
            """
        )
        for table in (
            "painting_measurements",
            "labour_weekly_attendance",
            "painting_projects",
            "painting_project_data",
        ):
            columns = {
                row["name"]
                for row in connection.execute(f"PRAGMA table_info({table})")
            }
            if "user_id" not in columns:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_painting_projects_user
            ON painting_projects (user_id, created_at)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_measurements_user
            ON painting_measurements (user_id)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_attendance_user
            ON labour_weekly_attendance (user_id)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_project_data_user
            ON painting_project_data (user_id)
            """
        )

    @app.before_request
    def authenticate_api_request() -> Any:
        if not request.path.startswith("/api/") or request.method == "OPTIONS":
            return None
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not _valid_auth_origin(
            request.headers.get("Origin"), app.config["AUTH_ALLOWED_ORIGINS"]
        ):
            return jsonify({"error": "Request origin is not allowed."}), 403

        public_paths = {
            "/api/health",
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/me",
            "/api/auth/password-reset/request",
            "/api/auth/password-reset/complete",
            "/api/auth/google",
            "/api/auth/google/callback",
        }
        if request.path in public_paths or request.path.startswith(
            "/api/paint-shades/"
        ):
            g.current_user_id = None
            return None

        token = request.cookies.get(app.config["AUTH_COOKIE_NAME"], "")
        if not token or len(token) > 200:
            return jsonify({"error": "Authentication is required."}), 401
        now = int(time.time())
        with _connect(app.config["DATABASE"]) as connection:
            row = connection.execute(
                """
                SELECT users.user_id, users.email, users.name
                FROM auth_sessions
                JOIN users ON users.user_id = auth_sessions.user_id
                WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
                """,
                (_token_hash(token), now),
            ).fetchone()
            connection.execute(
                "DELETE FROM auth_sessions WHERE expires_at <= ?", (now,)
            )
        if row is None:
            response = jsonify({"error": "Your session has expired. Please sign in."})
            response.delete_cookie(
                app.config["AUTH_COOKIE_NAME"],
                path="/api",
                samesite=app.config["AUTH_COOKIE_SAMESITE"],
            )
            return response, 401
        g.current_user_id = row["user_id"]
        g.current_user = {
            "id": row["user_id"],
            "email": row["email"],
            "name": row["name"],
        }
        return None

    def set_auth_cookie(
        response: Any, user_id: str, remember: bool = False
    ) -> None:
        token = secrets.token_urlsafe(48)
        expires_at = int(time.time()) + (
            app.config["AUTH_SESSION_TTL_SECONDS"] if remember else 60 * 60 * 12
        )
        with _connect(app.config["DATABASE"]) as connection:
            existing_token = request.cookies.get(app.config["AUTH_COOKIE_NAME"], "")
            if existing_token:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = ?",
                    (_token_hash(existing_token),),
                )
            connection.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (_token_hash(token), user_id, expires_at),
            )
        response.set_cookie(
            app.config["AUTH_COOKIE_NAME"],
            token,
            max_age=expires_at - int(time.time()),
            httponly=True,
            secure=app.config["AUTH_COOKIE_SECURE"],
            samesite=app.config["AUTH_COOKIE_SAMESITE"],
            path="/api",
        )

    def user_json(user: sqlite3.Row) -> dict[str, str]:
        return {
            "id": user["user_id"],
            "email": user["email"],
            "name": user["name"],
        }

    def configured_smtp() -> bool:
        return all(
            app.config.get(key)
            for key in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM")
        )

    @app.post("/api/auth/register")
    def register_account() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400
        name = payload.get("name")
        phone = payload.get("phone")
        email = payload.get("email")
        password = payload.get("password")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 120
            or not isinstance(phone, str)
            or not re.fullmatch(r"[6-9]\d{9}", phone)
            or not isinstance(email, str)
            or len(email) > 254
            or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip())
        ):
            return jsonify({"error": "Enter a valid name, Indian phone number, and email."}), 400
        if not _valid_password(password):
            return jsonify(
                {
                    "error": (
                        "Password must be 8–256 characters and include uppercase, "
                        "lowercase, and a number."
                    )
                }
            ), 400

        user_id = str(uuid.uuid4())
        normalized_email = email.strip().lower()
        try:
            with _connect(app.config["DATABASE"]) as connection:
                connection.execute(
                    """
                    INSERT INTO users (user_id, email, name, phone, password_hash)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        normalized_email,
                        name.strip(),
                        phone,
                        generate_password_hash(password, method="scrypt"),
                    ),
                )
                user = connection.execute(
                    "SELECT user_id, email, name FROM users WHERE user_id = ?",
                    (user_id,),
                ).fetchone()
        except sqlite3.IntegrityError:
            return jsonify({"error": "An account with this email already exists."}), 409

        response = jsonify({"user": user_json(user)})
        set_auth_cookie(response, user_id)
        return response, 201

    @app.post("/api/auth/login")
    def login_account() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({"error": "Enter your email and password."}), 400
        with _connect(app.config["DATABASE"]) as connection:
            user = connection.execute(
                """
                SELECT user_id, email, name, password_hash
                FROM users WHERE email = ? COLLATE NOCASE
                """,
                (email.strip().lower(),),
            ).fetchone()
        if (
            user is None
            or not user["password_hash"]
            or not check_password_hash(user["password_hash"], password)
        ):
            return jsonify({"error": "Email or password is incorrect."}), 401
        response = jsonify({"user": user_json(user)})
        set_auth_cookie(response, user["user_id"], payload.get("remember") is True)
        return response, 200

    @app.post("/api/auth/logout")
    def logout_account() -> tuple[Any, int]:
        token = request.cookies.get(app.config["AUTH_COOKIE_NAME"], "")
        if token:
            with _connect(app.config["DATABASE"]) as connection:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = ?",
                    (_token_hash(token),),
                )
        response = jsonify({"loggedOut": True})
        response.delete_cookie(
            app.config["AUTH_COOKIE_NAME"],
            path="/api",
            httponly=True,
            secure=app.config["AUTH_COOKIE_SECURE"],
            samesite=app.config["AUTH_COOKIE_SAMESITE"],
        )
        return response, 200

    @app.get("/api/auth/me")
    def current_account() -> tuple[Any, int]:
        token = request.cookies.get(app.config["AUTH_COOKIE_NAME"], "")
        if not token:
            return jsonify({"user": None}), 200
        with _connect(app.config["DATABASE"]) as connection:
            user = connection.execute(
                """
                SELECT users.user_id, users.email, users.name
                FROM auth_sessions
                JOIN users ON users.user_id = auth_sessions.user_id
                WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
                """,
                (_token_hash(token), int(time.time())),
            ).fetchone()
        return jsonify({"user": user_json(user) if user else None}), 200

    def profile_json(user: sqlite3.Row) -> dict[str, str]:
        return {
            "id": user["user_id"],
            "email": user["email"],
            "name": user["name"],
            "phone": user["phone"] or "",
            "createdAt": user["created_at"] or "",
        }

    @app.get("/api/profile")
    def get_profile() -> tuple[Any, int]:
        try:
            with _connect(app.config["DATABASE"]) as connection:
                user = connection.execute(
                    """
                    SELECT user_id, email, name, phone, created_at
                    FROM users
                    WHERE user_id = ?
                    """,
                    (g.current_user_id,),
                ).fetchone()
        except sqlite3.Error:
            app.logger.exception("Could not retrieve user profile")
            return jsonify({"error": "Could not load your profile."}), 500
        if user is None:
            return jsonify({"error": "Your account could not be found."}), 404
        return jsonify({"profile": profile_json(user)}), 200

    @app.put("/api/profile")
    def update_profile() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400
        name = payload.get("name")
        phone = payload.get("phone")
        normalized_name = name.strip() if isinstance(name, str) else ""
        if (
            not isinstance(name, str)
            or not normalized_name
            or len(normalized_name) > 120
            or any(ord(character) < 32 or ord(character) == 127 for character in normalized_name)
        ):
            return jsonify({"error": "Enter a name between 1 and 120 characters."}), 400
        if not isinstance(phone, str) or not re.fullmatch(
            r"[6-9][0-9]{9}", phone.strip()
        ):
            return jsonify({"error": "Enter a valid 10-digit Indian phone number."}), 400

        try:
            with _connect(app.config["DATABASE"]) as connection:
                connection.execute(
                    """
                    UPDATE users
                    SET name = ?, phone = ?
                    WHERE user_id = ?
                    """,
                    (normalized_name, phone.strip(), g.current_user_id),
                )
                user = connection.execute(
                    """
                    SELECT user_id, email, name, phone, created_at
                    FROM users
                    WHERE user_id = ?
                    """,
                    (g.current_user_id,),
                ).fetchone()
        except sqlite3.Error:
            app.logger.exception("Could not update user profile")
            return jsonify({"error": "Could not save your profile."}), 500
        if user is None:
            return jsonify({"error": "Your account could not be found."}), 404
        return jsonify({"profile": profile_json(user)}), 200

    @app.post("/api/auth/password-reset/request")
    def request_password_reset() -> tuple[Any, int]:
        if not configured_smtp():
            return jsonify(
                {
                    "error": (
                        "Password recovery email is not configured. Set SMTP_HOST, "
                        "SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM in backend/.env."
                    )
                }
            ), 503
        payload = request.get_json(silent=True)
        email = payload.get("email") if isinstance(payload, dict) else None
        if not isinstance(email, str) or not re.fullmatch(
            r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()
        ):
            return jsonify({"error": "Enter a valid email address."}), 400

        with _connect(app.config["DATABASE"]) as connection:
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE expires_at <= ?",
                (int(time.time()),),
            )
            user = connection.execute(
                "SELECT user_id, email, name FROM users WHERE email = ? COLLATE NOCASE",
                (email.strip().lower(),),
            ).fetchone()
            if user:
                token = secrets.token_urlsafe(40)
                expires_at = int(time.time()) + 60 * 60
                connection.execute(
                    "DELETE FROM password_reset_tokens WHERE user_id = ?",
                    (user["user_id"],),
                )
                connection.execute(
                    """
                    INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
                    VALUES (?, ?, ?)
                    """,
                    (_token_hash(token), user["user_id"], expires_at),
                )

        if user:
            reset_url = (
                f"{app.config['FRONTEND_URL'].rstrip('/')}/"
                f"?reset_token={token}"
            )
            message = EmailMessage()
            message["Subject"] = "Reset your PaintWise password"
            message["From"] = app.config["SMTP_FROM"]
            message["To"] = user["email"]
            message.set_content(
                f"Hello {user['name']},\n\n"
                "Use this link within one hour to reset your PaintWise password:\n"
                f"{reset_url}\n\nIf you did not request this, you can ignore this email."
            )
            try:
                with smtplib.SMTP(
                    app.config["SMTP_HOST"], app.config["SMTP_PORT"], timeout=15
                ) as server:
                    server.starttls()
                    server.login(
                        app.config["SMTP_USERNAME"], app.config["SMTP_PASSWORD"]
                    )
                    server.send_message(message)
            except (OSError, smtplib.SMTPException):
                app.logger.exception("Could not send password recovery email")
                return jsonify(
                    {"error": "Could not send the recovery email. Try again later."}
                ), 502

        return jsonify(
            {
                "message": (
                    "If an account exists for that email, a password reset link "
                    "has been sent."
                )
            }
        ), 200

    @app.post("/api/auth/password-reset/complete")
    def complete_password_reset() -> tuple[Any, int]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400
        token = payload.get("token")
        password = payload.get("password")
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            return jsonify({"error": "This password reset link is invalid or expired."}), 400
        if not _valid_password(password):
            return jsonify(
                {
                    "error": (
                        "Password must be 8–256 characters and include uppercase, "
                        "lowercase, and a number."
                    )
                }
            ), 400
        now = int(time.time())
        with _connect(app.config["DATABASE"]) as connection:
            reset = connection.execute(
                """
                SELECT user_id FROM password_reset_tokens
                WHERE token_hash = ? AND expires_at > ?
                """,
                (_token_hash(token), now),
            ).fetchone()
            if reset is None:
                return jsonify(
                    {"error": "This password reset link is invalid or expired."}
                ), 400
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE token_hash = ?",
                (_token_hash(token),),
            )
            connection.execute(
                "UPDATE users SET password_hash = ? WHERE user_id = ?",
                (generate_password_hash(password, method="scrypt"), reset["user_id"]),
            )
            connection.execute(
                "DELETE FROM auth_sessions WHERE user_id = ?", (reset["user_id"],)
            )
        return jsonify({"passwordReset": True}), 200

    def oauth_error(message: str) -> Any:
        return redirect(
            f"{app.config['FRONTEND_URL'].rstrip('/')}/?"
            f"{urlencode({'auth_error': message})}"
        )

    @app.get("/api/auth/google")
    def start_google_login() -> Any:
        client_id = app.config.get("GOOGLE_CLIENT_ID")
        client_secret = app.config.get("GOOGLE_CLIENT_SECRET")
        if not client_id or not client_secret:
            return oauth_error("Google sign-in is not configured on the server.")
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")
        with _connect(app.config["DATABASE"]) as connection:
            connection.execute(
                """
                INSERT INTO google_oauth_states
                    (state_hash, nonce, code_verifier, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (_token_hash(state), nonce, verifier, int(time.time()) + 600),
            )
            connection.execute(
                "DELETE FROM google_oauth_states WHERE expires_at <= ?",
                (int(time.time()),),
            )
        params = httpx.QueryParams(
            {
                "client_id": client_id,
                "redirect_uri": app.config["GOOGLE_REDIRECT_URI"],
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        response = redirect(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
        response.set_cookie(
            "paintwise_oauth_state",
            state,
            max_age=600,
            httponly=True,
            secure=app.config["AUTH_COOKIE_SECURE"],
            samesite=app.config["AUTH_COOKIE_SAMESITE"],
            path="/api/auth/google",
        )
        return response

    @app.get("/api/auth/google/callback")
    def complete_google_login() -> Any:
        state = request.args.get("state", "")
        state_cookie = request.cookies.get("paintwise_oauth_state", "")
        if (
            not state
            or len(state) > 200
            or not state_cookie
            or not hmac.compare_digest(state, state_cookie)
        ):
            return oauth_error("Google sign-in could not be verified. Please try again.")
        with _connect(app.config["DATABASE"]) as connection:
            oauth_state = connection.execute(
                """
                SELECT nonce, code_verifier FROM google_oauth_states
                WHERE state_hash = ? AND expires_at > ?
                """,
                (_token_hash(state), int(time.time())),
            ).fetchone()
            connection.execute(
                "DELETE FROM google_oauth_states WHERE state_hash = ?",
                (_token_hash(state),),
            )
        code = request.args.get("code", "")
        if oauth_state is None or not code:
            return oauth_error("Google sign-in expired or was cancelled.")
        if not app.config.get("GOOGLE_CLIENT_ID") or not app.config.get(
            "GOOGLE_CLIENT_SECRET"
        ):
            return oauth_error("Google sign-in is not configured on the server.")

        try:
            token_response = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": app.config["GOOGLE_CLIENT_ID"],
                    "client_secret": app.config["GOOGLE_CLIENT_SECRET"],
                    "redirect_uri": app.config["GOOGLE_REDIRECT_URI"],
                    "grant_type": "authorization_code",
                    "code_verifier": oauth_state["code_verifier"],
                },
                timeout=15,
            )
            token_response.raise_for_status()
            id_token = token_response.json().get("id_token")
            if not isinstance(id_token, str):
                return oauth_error("Google did not return a valid sign-in token.")
            identity_response = httpx.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": id_token},
                timeout=15,
            )
            identity_response.raise_for_status()
            identity = identity_response.json()
        except (httpx.HTTPError, ValueError):
            app.logger.exception("Google sign-in verification failed")
            return oauth_error("Could not verify your Google account. Please try again.")

        if (
            identity.get("aud") != app.config["GOOGLE_CLIENT_ID"]
            or identity.get("azp", app.config["GOOGLE_CLIENT_ID"])
            != app.config["GOOGLE_CLIENT_ID"]
            or identity.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}
            or not str(identity.get("exp", "")).isdigit()
            or int(identity["exp"]) <= int(time.time())
            or identity.get("nonce") != oauth_state["nonce"]
            or identity.get("email_verified") not in {"true", True}
            or not identity.get("sub")
            or not identity.get("email")
        ):
            return oauth_error("Google did not verify this account.")
        email = str(identity["email"]).strip().lower()
        google_sub = str(identity["sub"])
        try:
            with _connect(app.config["DATABASE"]) as connection:
                user = connection.execute(
                    "SELECT user_id, email, name, google_sub FROM users WHERE google_sub = ?",
                    (google_sub,),
                ).fetchone()
                if user is None:
                    user = connection.execute(
                        "SELECT user_id, email, name, google_sub FROM users WHERE email = ? COLLATE NOCASE",
                        (email,),
                    ).fetchone()
                if user is None:
                    user_id = str(uuid.uuid4())
                    name = str(identity.get("name") or email.split("@", 1)[0])[:120]
                    connection.execute(
                        """
                        INSERT INTO users (user_id, email, name, google_sub)
                        VALUES (?, ?, ?, ?)
                        """,
                        (user_id, email, name, google_sub),
                    )
                else:
                    user_id = user["user_id"]
                    if user["google_sub"] not in {None, google_sub}:
                        return oauth_error("This email is linked to another Google account.")
                    connection.execute(
                        "UPDATE users SET google_sub = ? WHERE user_id = ?",
                        (google_sub, user_id),
                    )
        except sqlite3.IntegrityError:
            app.logger.warning("Google account could not be linked to this email")
            return oauth_error("This Google account is already linked to another user.")

        response = redirect(app.config["FRONTEND_URL"].rstrip("/") + "/")
        set_auth_cookie(response, user_id, remember=True)
        response.delete_cookie(
            "paintwise_oauth_state",
            path="/api/auth/google",
            secure=app.config["AUTH_COOKIE_SECURE"],
            samesite="Lax",
        )
        return response

    @app.get("/api/health")
    def health() -> tuple[Any, int]:
        return jsonify({"status": "ok"}), 200

    @app.post("/api/chat")
    def chat() -> tuple[Any, int]:
        if request.content_length and request.content_length > MAX_CHAT_REQUEST_BYTES:
            return jsonify({"error": "Chat request is too large."}), 413

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400

        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return jsonify({"error": "Please enter a message."}), 400
        message = message.strip()
        if len(message) > MAX_CHAT_MESSAGE_LENGTH:
            return jsonify(
                {"error": f"Messages must be {MAX_CHAT_MESSAGE_LENGTH} characters or fewer."}
            ), 400

        history = payload.get("history", [])
        if not isinstance(history, list) or len(history) > MAX_CHAT_HISTORY_MESSAGES:
            return jsonify(
                {"error": f"Conversation history can contain up to {MAX_CHAT_HISTORY_MESSAGES} messages."}
            ), 400

        contents: list[dict[str, Any]] = []
        for item in history:
            if (
                not isinstance(item, dict)
                or set(item) != {"role", "text"}
                or item["role"] not in {"user", "assistant"}
                or not isinstance(item["text"], str)
                or not item["text"].strip()
                or len(item["text"]) > MAX_CHAT_HISTORY_ITEM_LENGTH
            ):
                return jsonify({"error": "Conversation history is invalid."}), 400
            contents.append(
                {
                    "role": "model" if item["role"] == "assistant" else "user",
                    "parts": [{"text": item["text"].strip()}],
                }
            )
        contents.append({"role": "user", "parts": [{"text": message}]})

        api_key = app.config.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify(
                {"error": "The AI assistant is not configured. Set GEMINI_API_KEY in the backend .env file."}
            ), 503

        try:
            client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(
                    timeout=app.config["GEMINI_TIMEOUT_MS"]
                ),
            )
            result = client.models.generate_content(
                model=app.config["GEMINI_MODEL"],
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=CHAT_SYSTEM_INSTRUCTION
                ),
            )
            answer = result.text
            if not isinstance(answer, str) or not answer.strip():
                app.logger.warning("Gemini returned an empty chat response")
                return jsonify(
                    {"error": "The AI could not generate a response. Please try again."}
                ), 502
        except APIError as error:
            status_code = error.code
            app.logger.warning("Gemini API returned HTTP %s", status_code)
            if status_code == 429:
                return jsonify(
                    {"error": "The AI service is busy. Please wait a moment and try again."}
                ), 429
            if status_code in {401, 403}:
                return jsonify(
                    {"error": "Gemini rejected the backend API key. Check GEMINI_API_KEY."}
                ), 503
            if status_code == 404:
                return jsonify(
                    {"error": "The configured Gemini model is unavailable. Check GEMINI_MODEL."}
                ), 503
            return jsonify(
                {"error": "The AI service could not complete this request. Please try again."}
            ), 502
        except httpx.TimeoutException:
            app.logger.warning("Gemini chat request timed out")
            return jsonify(
                {"error": "The AI service took too long to respond. Please try again."}
            ), 504
        except httpx.NetworkError:
            app.logger.warning("Gemini chat request could not reach the service")
            return jsonify(
                {"error": "Could not connect to the AI service. Check the backend network and try again."}
            ), 502
        except Exception as error:
            app.logger.error("Gemini chat failed (%s)", type(error).__name__)
            return jsonify(
                {"error": "The AI service could not complete this request. Please try again."}
            ), 502

        return jsonify({"reply": answer.strip()}), 200

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
                WHERE user_id = ?
                ORDER BY created_at, project_id
                """,
                (g.current_user_id,),
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
                    (project_id, workspace_id, name, customer_name, location,
                     deadline, status, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    normalized_workspace_id,
                    payload["name"].strip(),
                    payload["customerName"].strip(),
                    payload["location"].strip(),
                    payload["deadline"],
                    payload["status"],
                    g.current_user_id,
                ),
            )
            row = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects WHERE project_id = ? AND user_id = ?
                """,
                (project_id, g.current_user_id),
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
                WHERE project_id = ? AND user_id = ?
                """,
                (
                    payload["name"].strip(),
                    payload["customerName"].strip(),
                    payload["location"].strip(),
                    payload["deadline"],
                    payload["status"],
                    normalized_project_id,
                    g.current_user_id,
                ),
            )
            if cursor.rowcount == 0:
                return jsonify({"error": "Project was not found in this account."}), 404
            row = connection.execute(
                """
                SELECT project_id, name, customer_name, location, deadline, status,
                       created_at, updated_at
                FROM painting_projects WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
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
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this account."}), 404

            connection.execute(
                "DELETE FROM labour_weekly_attendance WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            )
            connection.execute(
                "DELETE FROM painting_measurements WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            )
            connection.execute(
                "DELETE FROM painting_project_data WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            )
            connection.execute(
                "DELETE FROM painting_projects WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
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
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            row = connection.execute(
                """
                SELECT data_json FROM painting_project_data
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
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
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            connection.execute(
                """
                INSERT INTO painting_project_data (project_id, data_json, user_id)
                VALUES (?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    data_json = excluded.data_json,
                    user_id = excluded.user_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    normalized_project_id,
                    json.dumps(payload, separators=(",", ":")),
                    g.current_user_id,
                ),
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
                LEFT JOIN painting_project_data AS d
                    ON d.project_id = p.project_id AND d.user_id = p.user_id
                WHERE p.user_id = ?
                ORDER BY p.created_at, p.project_id
                """,
                (g.current_user_id,),
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
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project was not found in this workspace."}), 404
            measurement = connection.execute(
                """
                SELECT measurements_json FROM painting_measurements
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            project_data = connection.execute(
                """
                SELECT data_json FROM painting_project_data
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            attendance_rows = connection.execute(
                """
                SELECT week_start, attendance_json, updated_at
                FROM labour_weekly_attendance
                WHERE project_id = ? AND user_id = ?
                ORDER BY week_start
                """,
                (normalized_project_id, g.current_user_id),
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
            project = connection.execute(
                "SELECT 1 FROM painting_projects WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "House project was not found."}), 404
            row = connection.execute(
                """
                SELECT measurements_json, updated_at
                FROM painting_measurements
                WHERE project_id = ? AND user_id = ?
                """,
                (normalized_project_id, g.current_user_id),
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
            project = connection.execute(
                "SELECT 1 FROM painting_projects WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "House project was not found."}), 404
            connection.execute(
                """
                INSERT INTO painting_measurements
                    (project_id, measurements_json, user_id)
                VALUES (?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    measurements_json = excluded.measurements_json,
                    user_id = excluded.user_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (normalized_project_id, serialized_measurements, g.current_user_id),
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
            project = connection.execute(
                "SELECT 1 FROM painting_projects WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "House project was not found."}), 404
            row = connection.execute(
                """
                SELECT attendance_json, updated_at
                FROM labour_weekly_attendance
                WHERE project_id = ? AND week_start = ? AND user_id = ?
                """,
                (normalized_project_id, week_start, g.current_user_id),
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
            project = connection.execute(
                "SELECT 1 FROM painting_projects WHERE project_id = ? AND user_id = ?",
                (normalized_project_id, g.current_user_id),
            ).fetchone()
            if project is None:
                return jsonify({"error": "House project was not found."}), 404
            connection.execute(
                """
                INSERT INTO labour_weekly_attendance
                    (project_id, week_start, attendance_json, user_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(project_id, week_start) DO UPDATE SET
                    attendance_json = excluded.attendance_json,
                    user_id = excluded.user_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    normalized_project_id,
                    week_start,
                    serialized_attendance,
                    g.current_user_id,
                ),
            )
        return jsonify({"saved": True}), 200
    
    
    
    @app.post("/api/home-design/local-preview")
    def generate_local_home_design_preview() -> tuple[Any, int]:
        uploaded_file = request.files.get("image")
        if uploaded_file is None:
            return jsonify({"error": "Please upload a house photo."}), 400
        if uploaded_file.mimetype not in {"image/jpeg", "image/png", "image/webp"}:
            return jsonify({"error": "Upload a JPEG, PNG, or WebP house image."}), 400

        wall_color = request.form.get("wall_color", "").strip()
        trim_color = request.form.get("trim_color", "").strip()
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", wall_color) or not re.fullmatch(
            r"#[0-9A-Fa-f]{6}", trim_color
        ):
            return jsonify(
                {"error": "Wall and trim colours must be valid hex values."}
            ), 400

        image_bytes = uploaded_file.read(10 * 1024 * 1024 + 1)
        if not image_bytes:
            return jsonify({"error": "The uploaded image is empty."}), 400
        if len(image_bytes) > 10 * 1024 * 1024:
            return jsonify({"error": "Image must be under 10 MB."}), 413

        try:
            with Image.open(BytesIO(image_bytes)) as opened_image:
                original = ImageOps.exif_transpose(opened_image).convert("RGB")
                original.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                image_rgb = np.asarray(original, dtype=np.uint8)
        except (Image.DecompressionBombError, OSError, ValueError):
            return jsonify(
                {"error": "The uploaded file is not a readable house image."}
            ), 400

        height, width = image_rgb.shape[:2]

        def read_mask(field: str, required: bool) -> np.ndarray | None:
            mask_file = request.files.get(field)
            if mask_file is None:
                if required:
                    raise ValueError(f"A {field.replace('_', ' ')} is required.")
                return None
            if mask_file.mimetype != "image/png":
                raise ValueError(f"{field.replace('_', ' ').title()} must be a PNG.")
            mask_bytes = mask_file.read(2 * 1024 * 1024 + 1)
            if not mask_bytes:
                raise ValueError(f"{field.replace('_', ' ').title()} is empty.")
            if len(mask_bytes) > 2 * 1024 * 1024:
                raise ValueError(f"{field.replace('_', ' ').title()} must be under 2 MB.")
            try:
                with Image.open(BytesIO(mask_bytes)) as opened_mask:
                    mask = np.asarray(opened_mask.convert("L"), dtype=np.uint8)
            except (Image.DecompressionBombError, OSError, ValueError) as error:
                raise ValueError(
                    f"{field.replace('_', ' ').title()} is not a readable PNG."
                ) from error
            if mask.shape != (height, width):
                raise ValueError(
                    f"{field.replace('_', ' ').title()} dimensions must match the resized house image."
                )
            return mask

        try:
            wall_mask = read_mask("wall_mask", required=True)
            trim_mask = read_mask("trim_mask", required=True)
            protected_mask = read_mask("protected_mask", required=False)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        supplied_coverage = int(
            np.count_nonzero(np.maximum(wall_mask, trim_mask))
        )
        if supplied_coverage >= width * height * 0.98:
            return jsonify(
                {
                    "error": (
                        "The selected mask covers too much of the photo. Refine "
                        "the wall and trim masks; the image was not recoloured."
                    )
                }
            ), 400

        if protected_mask is not None:
            wall_mask = cv2.bitwise_and(wall_mask, cv2.bitwise_not(protected_mask))
            trim_mask = cv2.bitwise_and(trim_mask, cv2.bitwise_not(protected_mask))
        wall_mask[trim_mask > 0] = 0

        wall_coverage = int(np.count_nonzero(wall_mask))
        trim_coverage = int(np.count_nonzero(trim_mask))
        image_area = width * height
        selected_coverage = int(
            np.count_nonzero(np.maximum(wall_mask, trim_mask))
        )
        if wall_coverage == 0:
            return jsonify(
                {
                    "error": (
                        "No wall pixels are selected. Use the wall-mask editor to "
                        "mark only the exterior walls; the image was not recoloured."
                    )
                }
            ), 400
        if selected_coverage >= image_area * 0.98:
            return jsonify(
                {
                    "error": (
                        "The selected mask covers too much of the photo. Refine "
                        "the wall and trim masks; the image was not recoloured."
                    )
                }
            ), 400

        try:
            image_lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB).astype(
                np.float32
            )
            output_lab = image_lab.copy()
            for mask, colour in ((wall_mask, wall_color), (trim_mask, trim_color)):
                if not np.any(mask):
                    continue
                rgb = np.array(
                    [int(colour[index : index + 2], 16) for index in (1, 3, 5)],
                    dtype=np.uint8,
                ).reshape(1, 1, 3)
                target_lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[0, 0].astype(
                    np.float32
                )
                alpha = (mask.astype(np.float32) / 255.0 * 0.82)[..., None]
                output_lab[:, :, 1:] = np.where(
                    alpha > 0,
                    output_lab[:, :, 1:]
                    * (1.0 - alpha)
                    + target_lab[1:][None, None, :] * alpha,
                    output_lab[:, :, 1:],
                )

            output_rgb = cv2.cvtColor(
                np.clip(output_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB
            )
            selected_mask = np.maximum(wall_mask, trim_mask) > 0
            output_rgb[~selected_mask] = image_rgb[~selected_mask]
            success, encoded = cv2.imencode(
                ".png", cv2.cvtColor(output_rgb, cv2.COLOR_RGB2BGR)
            )
        except (cv2.error, ValueError, TypeError):
            app.logger.exception("OpenCV failed to render a local house preview")
            return jsonify(
                {"error": "OpenCV could not render this local preview. Please try again."}
            ), 500
        if not success:
            app.logger.error("OpenCV could not encode a local house-design preview")
            return jsonify({"error": "Could not encode the local preview image."}), 500
        image_base64 = base64.b64encode(encoded.tobytes()).decode("ascii")
        return jsonify(
            {
                "image": f"data:image/png;base64,{image_base64}",
                "method": "local-opencv",
                "wall_pixels": wall_coverage,
                "trim_pixels": trim_coverage,
            }
        ), 200

    @app.post("/api/home-design/preview")
    def generate_home_design_preview() -> tuple[Any, int]:
        api_key = app.config.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify(
                {
                    "error": (
                        "House design generation is not configured. "
                        "Set GEMINI_API_KEY in the backend .env file."
                    )
                }
            ), 503

        uploaded_file = request.files.get("image")
        if uploaded_file is None:
            return jsonify({"error": "Please upload a house photo."}), 400
        if uploaded_file.mimetype not in {
            "image/jpeg",
            "image/png",
            "image/webp",
        }:
            return jsonify({"error": "Upload a JPEG, PNG, or WebP house image."}), 400

        wall_color = request.form.get("wall_color", "#E8D7B5").strip()
        trim_color = request.form.get("trim_color", "#79513A").strip()
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
            return jsonify(
                {"error": "Color names must contain only letters, spaces, or hyphens."}
            ), 400
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", wall_color) or not re.fullmatch(
            r"#[0-9A-Fa-f]{6}", trim_color
        ):
            return jsonify(
                {"error": "Wall and trim colours must be valid hex values."}
            ), 400

        image_bytes = uploaded_file.read(10 * 1024 * 1024 + 1)
        if not image_bytes:
            return jsonify({"error": "The uploaded image is empty."}), 400
        if len(image_bytes) > 10 * 1024 * 1024:
            return jsonify({"error": "Image must be under 10 MB."}), 400

        try:
            with Image.open(BytesIO(image_bytes)) as original:
                original = original.convert("RGB")
                original.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                buffer = BytesIO()
                original.save(buffer, format="PNG")
                image_bytes = buffer.getvalue()
        except (Image.DecompressionBombError, OSError, ValueError):
            return jsonify({"error": "The uploaded file is not a readable house image."}), 400

        prompt = f"""IMAGE EDITING TASK: create a photorealistic paint-colour visualization from
the supplied house photo, not a new house design.

Use the uploaded photo as the base. Repaint only the exterior walls using
{wall_color_name} ({wall_color}) and existing borders and trim using
{trim_color_name} ({trim_color}). Match both selected HEX colours clearly.
Preserve natural shadows, lighting, and wall texture.

Keep the original architecture, house recognizable, perspective, composition,
roof, windows, doors, steps, surroundings, and camera angle unchanged. Do not
add or remove doors, windows, floors, steps, or architectural structures. Do
not crop, replace, or redesign the house. Change only the paint colours on
existing exterior wall and trim surfaces."""

        try:
            client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(
                    timeout=app.config["GEMINI_IMAGE_TIMEOUT_MS"]
                ),
            )
            response = client.models.generate_content(
                model=app.config["GEMINI_IMAGE_MODEL"],
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                ],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"]
                ),
            )

            generated_bytes = None
            for candidate in response.candidates or []:
                content = getattr(candidate, "content", None)
                for part in getattr(content, "parts", []) or []:
                    inline_data = getattr(part, "inline_data", None)
                    data = getattr(inline_data, "data", None)
                    if data:
                        generated_bytes = data
                        break
                if generated_bytes:
                    break
            if not generated_bytes:
                app.logger.warning("Gemini returned no image for a home-design request")
                return jsonify(
                    {"error": "Gemini did not return an image. Please try again."}
                ), 502

            try:
                with Image.open(BytesIO(generated_bytes)) as generated_image:
                    generated_image = generated_image.convert("RGB")
                    output = BytesIO()
                    generated_image.save(output, format="PNG")
            except (Image.DecompressionBombError, OSError, ValueError):
                app.logger.warning("Gemini returned an unreadable home-design image")
                return jsonify(
                    {"error": "Gemini returned an invalid image. Please try again."}
                ), 502

            image_base64 = base64.b64encode(output.getvalue()).decode("ascii")
            return jsonify({"image": f"data:image/png;base64,{image_base64}"}), 200
        except APIError as error:
            status_code = error.code
            retry_after_seconds = (
                _gemini_retry_after_seconds(error) if status_code == 429 else None
            )
            app.logger.warning(
                "Gemini image API returned HTTP %s (retry after: %s)",
                status_code,
                retry_after_seconds,
            )
            if status_code == 429:
                if retry_after_seconds is not None:
                    return jsonify(
                        {
                            "error": (
                                "Gemini image generation is temporarily "
                                "rate-limited. No automatic retry was attempted."
                            ),
                            "retry_after_seconds": retry_after_seconds,
                            "fallback_available": True,
                        }
                    ), 429
                return jsonify(
                    {
                        "error": (
                            "Gemini's image-generation quota is unavailable or "
                            "exhausted for this project/model. Check the model's "
                            "Google AI Studio quota and billing."
                        ),
                        "fallback_available": True,
                    }
                ), 429
            if status_code in {401, 403}:
                return jsonify(
                    {"error": "Gemini rejected the backend API key. Check GEMINI_API_KEY."}
                ), 503
            if status_code == 404:
                return jsonify(
                    {
                        "error": (
                            "The configured Gemini image model is unavailable. "
                            "Check GEMINI_IMAGE_MODEL."
                        )
                    }
                ), 503
            return jsonify(
                {"error": "Gemini could not generate this design. Please try again."}
            ), 502
        except httpx.TimeoutException:
            app.logger.warning("Gemini home-design image request timed out")
            return jsonify(
                {"error": "Gemini took too long to generate the design. Please try again."}
            ), 504
        except httpx.NetworkError:
            app.logger.warning("Gemini home-design image request could not connect")
            return jsonify(
                {"error": "Could not connect to Gemini. Check the server connection."}
            ), 502
        except Exception:
            app.logger.exception("Gemini home-design preview failed")
            return jsonify(
                {"error": "Image preview failed. Check the Flask server logs."}
            ), 500

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
