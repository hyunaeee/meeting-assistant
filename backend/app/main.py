import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import config
from app.services.claude import summarize_transcript
from app.services.emailer import send_meeting_email
from app.services.notion import upload as upload_to_notion
from app.services.stt import transcribe_audio

app = FastAPI(title="LIKE meeting assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # allow_credentials=True 와 allow_origins=["*"] 는 CORS 스펙상 함께 쓸 수 없다.
    # 이 앱은 쿠키/인증을 쓰지 않으므로 credentials 를 끄고 "*" 를 유효하게 둔다.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SavePayload(BaseModel):
    title: Optional[str] = ""
    participants: list[str] = []
    emails: list[str] = []
    transcript: str


class SendEmailPayload(BaseModel):
    emails: list[str] = []
    notes: dict
    notion_url: Optional[str] = ""


@app.get("/health")
def health():
    return {
        "ok": True,
        "notion_location": config.NOTION_DEFAULT_LOCATION,
        "notion_page_configured": bool(config.NOTION_PAGE_ID),
        "notion_database_configured": bool(config.NOTION_DATABASE_ID),
        "claude_configured": bool(config.ANTHROPIC_API_KEY),
        "smtp_configured": bool(config.SMTP_USER and config.SMTP_PASSWORD),
    }


@app.post("/api/meetings/process")
async def process_meeting(
    audio: UploadFile = File(...),
    title: str = Form(""),
    participants: str = Form("[]"),
    emails: str = Form("[]"),
    duration_seconds: float = Form(0),
):
    meeting_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = audio.filename or "meeting.webm"
    audio_path = config.RECORDINGS_DIR / f"{meeting_id}_{safe_name}"

    with audio_path.open("wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)

    participant_list = _parse_json_list(participants)
    email_list = _parse_json_list(emails)

    try:
        transcript = transcribe_audio(audio_path)
    except Exception as exc:
        transcript = f"[00:00:00 - 00:00:01] 전사 처리 실패: {exc}"

    notes = summarize_transcript(transcript, meeting_title=title, participants=participant_list)

    notion_url = ""
    notion_error = ""
    try:
        notion_url = upload_to_notion(notes, transcript)
    except Exception as exc:
        notion_error = str(exc)

    result = {
        "meeting_id": meeting_id,
        "transcript": transcript,
        "notes": notes,
        "notion_url": notion_url,
        "notion_error": notion_error,
        "email_sent": False,
        "email_error": "",
        "duration_seconds": duration_seconds,
        "requested_emails": email_list,
    }
    _save_result(meeting_id, result)
    return result


@app.post("/api/meetings/save-text")
def save_text_meeting(payload: SavePayload):
    meeting_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    notes = summarize_transcript(payload.transcript, meeting_title=payload.title or "", participants=payload.participants)

    notion_url = ""
    notion_error = ""
    try:
        notion_url = upload_to_notion(notes, payload.transcript)
    except Exception as exc:
        notion_error = str(exc)

    result = {
        "meeting_id": meeting_id,
        "transcript": payload.transcript,
        "notes": notes,
        "notion_url": notion_url,
        "notion_error": notion_error,
        "email_sent": False,
        "email_error": "",
        "duration_seconds": 0,
        "requested_emails": payload.emails,
    }
    _save_result(meeting_id, result)
    return result


@app.post("/api/meetings/send-email")
def send_email_after_meeting(payload: SendEmailPayload):
    if not payload.emails:
        return {"sent": False, "error": "전달할 이메일이 없습니다."}
    try:
        send_meeting_email(payload.emails, payload.notes, payload.notion_url or "")
        return {"sent": True, "error": ""}
    except Exception as exc:
        return {"sent": False, "error": str(exc)}


def _parse_json_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
    except Exception:
        pass
    return []


def _save_result(meeting_id: str, result: dict) -> None:
    """기존 CLI 구현처럼 결과물을 파일로도 남깁니다.
    - storage/<meeting_id>.json: 전체 처리 결과
    - storage/<meeting_id>_notes.json: Claude가 만든 회의록 JSON
    - storage/<meeting_id>_transcript.txt: Whisper 전사본
    """
    path = config.STORAGE_DIR / f"{meeting_id}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    notes_path = config.STORAGE_DIR / f"{meeting_id}_notes.json"
    notes_path.write_text(json.dumps(result.get("notes", {}), ensure_ascii=False, indent=2), encoding="utf-8")

    transcript_path = config.STORAGE_DIR / f"{meeting_id}_transcript.txt"
    transcript_path.write_text(result.get("transcript", ""), encoding="utf-8")
