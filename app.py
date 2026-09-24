import base64
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel, Field


load_dotenv(Path(__file__).parent / ".env")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "personal_notebook")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-local-secret")
TOKEN_TTL = 60 * 60 * 12
configured_origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",") if origin.strip()]
FRONTEND_ORIGINS = list(dict.fromkeys([*configured_origins, "https://mujeeb8.github.io", "https://note.mujeeeeb.com"]))

app = FastAPI(title="Papertrail Notebook")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
mongo_client = AsyncIOMotorClient(MONGO_URL)


class SetupPayload(BaseModel):
    password: str = Field(min_length=8, max_length=256)
    security_question: str = Field(min_length=5, max_length=200)
    security_answer: str = Field(min_length=2, max_length=200)


class LoginPayload(BaseModel):
    password: str


class RecoveryPayload(BaseModel):
    security_answer: str
    new_password: str = Field(min_length=8, max_length=256)


class NotePayload(BaseModel):
    title: str = Field(default="", max_length=160)
    content: str = Field(max_length=1_000_000)


def database() -> AsyncIOMotorDatabase:
    return mongo_client[DATABASE_NAME]


def password_hash(value: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, 210_000)
    return f"{base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def password_matches(value: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, 210_000)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def answer_hash(value: str) -> str:
    return hashlib.sha256(value.strip().casefold().encode()).hexdigest()


def make_token() -> str:
    timestamp = str(int(time.time()))
    signature = hmac.new(SECRET_KEY.encode(), timestamp.encode(), hashlib.sha256).hexdigest()
    return f"{timestamp}.{signature}"


def valid_token(token: str) -> bool:
    try:
        timestamp_text, signature = token.split(".", 1)
        timestamp = int(timestamp_text)
        expected = hmac.new(SECRET_KEY.encode(), timestamp_text.encode(), hashlib.sha256).hexdigest()
        return time.time() - timestamp < TOKEN_TTL and hmac.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False


async def require_auth(request: Request) -> AsyncIOMotorDatabase:
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip()
    if not valid_token(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return database()


async def settings_doc(db: AsyncIOMotorDatabase) -> Optional[dict]:
    return await db.settings.find_one({"_id": "security"})


@app.get("/api/setup-status")
async def setup_status() -> dict:
    settings = await settings_doc(database())
    return {"configured": settings is not None, "security_question": settings.get("security_question") if settings else None}


@app.post("/api/setup")
async def setup(payload: SetupPayload) -> dict:
    db = database()
    if await settings_doc(db):
        raise HTTPException(status_code=409, detail="Notebook is already configured")
    await db.settings.insert_one({
        "_id": "security",
        "password_hash": password_hash(payload.password),
        "security_question": payload.security_question.strip(),
        "security_answer_hash": answer_hash(payload.security_answer),
        "created_at": datetime.now(timezone.utc),
    })
    return {"token": make_token()}


@app.post("/api/login")
async def login(payload: LoginPayload) -> dict:
    settings = await settings_doc(database())
    if not settings:
        raise HTTPException(status_code=428, detail="Complete setup first")
    if not password_matches(payload.password, settings["password_hash"]):
        raise HTTPException(status_code=401, detail="That password is not correct")
    return {"token": make_token()}


@app.get("/api/recovery/question")
async def recovery_question() -> dict:
    settings = await settings_doc(database())
    if not settings:
        raise HTTPException(status_code=404, detail="Complete setup first")
    return {"question": settings["security_question"]}


@app.post("/api/recovery/reset")
async def recovery_reset(payload: RecoveryPayload) -> dict:
    db = database()
    settings = await settings_doc(db)
    if not settings:
        raise HTTPException(status_code=404, detail="Complete setup first")
    if not hmac.compare_digest(answer_hash(payload.security_answer), settings["security_answer_hash"]):
        raise HTTPException(status_code=401, detail="That answer is not correct")
    await db.settings.update_one({"_id": "security"}, {"$set": {"password_hash": password_hash(payload.new_password)}})
    return {"token": make_token()}


@app.get("/api/notes")
async def list_notes(db: AsyncIOMotorDatabase = Depends(require_auth)) -> list[dict]:
    notes = []
    async for note in db.notes.find({}, {"title": 1, "content": 1, "updated_at": 1}).sort("updated_at", -1):
        content = note.get("content", "")
        notes.append({
            "id": str(note["_id"]),
            "title": note["title"],
            "preview": content[:180].replace("\n", " "),
            "updated_at": note["updated_at"].isoformat(),
        })
    return notes


@app.get("/api/notes/{note_id}")
async def get_note(note_id: str, db: AsyncIOMotorDatabase = Depends(require_auth)) -> dict:
    if not ObjectId.is_valid(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    note = await db.notes.find_one({"_id": ObjectId(note_id)})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"id": str(note["_id"]), "title": note["title"], "content": note["content"], "updated_at": note["updated_at"].isoformat()}


@app.post("/api/notes")
async def create_note(payload: NotePayload, db: AsyncIOMotorDatabase = Depends(require_auth)) -> dict:
    now = datetime.now(timezone.utc)
    result = await db.notes.insert_one({"title": payload.title.strip(), "content": payload.content, "updated_at": now})
    return {"id": str(result.inserted_id), "title": payload.title.strip(), "content": payload.content, "updated_at": now.isoformat()}


@app.put("/api/notes/{note_id}")
async def update_note(note_id: str, payload: NotePayload, db: AsyncIOMotorDatabase = Depends(require_auth)) -> dict:
    if not ObjectId.is_valid(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    now = datetime.now(timezone.utc)
    result = await db.notes.update_one({"_id": ObjectId(note_id)}, {"$set": {"title": payload.title.strip(), "content": payload.content, "updated_at": now}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"id": note_id, "title": payload.title.strip(), "content": payload.content, "updated_at": now.isoformat()}


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, db: AsyncIOMotorDatabase = Depends(require_auth)) -> dict:
    if not ObjectId.is_valid(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    result = await db.notes.delete_one({"_id": ObjectId(note_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"deleted": True}


@app.get("/", include_in_schema=False)
async def api_status() -> JSONResponse:
    return JSONResponse({"service": "personal-notebook", "status": "ok"})


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


