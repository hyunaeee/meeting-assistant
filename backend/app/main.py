import json
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import config
from app.services.claude import guess_speaker_mapping, summarize_transcript
from app.services.emailer import send_meeting_email
from app.services.notion import upload as upload_to_notion
from app.services import diarize as diarize_svc
from app.services.stt import preload_model, segments_to_text, transcribe_segments


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 무거운 모델을 미리 로드해 첫 요청 콜드스타트로 인한 nginx 504 를 방지한다.
    # 로딩에 실패해도(예: GPU 미탑재/모델 약관 미동의) 앱은 뜨게 두고 요청 시 재시도한다.
    try:
        preload_model()
        print("[startup] Whisper model preloaded.")
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] Whisper preload failed (will retry on first request): {exc}")
    try:
        diarize_svc.preload_pipeline()
        print("[startup] Diarization pipeline preloaded.")
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] Diarization preload failed (will fall back to no speakers): {exc}")
    yield


app = FastAPI(title="LIKE meeting assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # allow_credentials=True 와 allow_origins=["*"] 는 CORS 스펙상 함께 쓸 수 없다.
    # 이 앱은 쿠키/인증을 쓰지 않으므로 credentials 를 끄고 "*" 를 유효하게 둔다.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 비동기 회의록 처리용 인메모리 job 저장소 ──────────────────────────────
# process 요청은 즉시 job_id 만 돌려주고, 실제 처리는 백그라운드 스레드에서 수행한다.
# 프론트는 /api/meetings/status/{job_id} 를 폴링한다. 각 요청이 짧아 프록시 60초
# 타임아웃(504)에 걸리지 않는다.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
# Whisper 모델은 동시 호출에 안전하지 않을 수 있어 전사만 직렬화한다.
_transcribe_lock = threading.Lock()


def _run_meeting_job(
    job_id: str,
    audio_path: Path,
    title: str,
    participant_list: list[str],
    email_list: list[str],
    duration_seconds: float,
    meeting_id: str,
    department: str = "",
    registrant: str = "",
    upload_date: str = "",
) -> None:
    try:
        segments: list[dict] = []
        with _transcribe_lock:
            try:
                segments, wav_path = transcribe_segments(audio_path)
                # 화자 분리(실패해도 화자 없이 진행)
                try:
                    turns = diarize_svc.diarize(wav_path)
                    segments = diarize_svc.assign_speakers(segments, turns)
                except Exception as exc:  # noqa: BLE001
                    print(f"[diarize] 화자 분리 실패, 화자 없이 진행: {exc}")
                transcript = segments_to_text(segments)
            except Exception as exc:  # noqa: BLE001
                segments = []
                transcript = f"[00:00:00 - 00:00:01] 전사 처리 실패: {exc}"

        notes = summarize_transcript(
            transcript, meeting_title=title, participants=participant_list
        )

        # 등장 순서대로 고유 화자 목록 → 대화 내용으로 참가자 추측 매핑(best-effort)
        speaker_labels: list[str] = []
        for seg in segments:
            sp = seg.get("speaker")
            if sp and sp not in speaker_labels:
                speaker_labels.append(sp)
        speaker_guess = guess_speaker_mapping(transcript, speaker_labels, participant_list)

        notion_url = ""
        notion_error = ""
        try:
            notion_url = upload_to_notion(
                notes,
                transcript,
                department=department,
                registrant=registrant,
                upload_date=upload_date,
            )
        except Exception as exc:  # noqa: BLE001
            notion_error = str(exc)

        result = {
            "meeting_id": meeting_id,
            "transcript": transcript,
            "segments": segments,
            "speaker_guess": speaker_guess,
            "notes": notes,
            "notion_url": notion_url,
            "notion_error": notion_error,
            "department": department,
            "registrant": registrant,
            "upload_date": upload_date,
            "email_sent": False,
            "email_error": "",
            "duration_seconds": duration_seconds,
            "requested_emails": email_list,
        }
        _save_result(meeting_id, result)
        with _jobs_lock:
            _jobs[job_id] = {"status": "done", "result": result}
    except Exception as exc:  # noqa: BLE001
        with _jobs_lock:
            _jobs[job_id] = {"status": "error", "error": str(exc)}


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


@app.get("/api/meetings/departments")
def departments():
    """프론트 드롭다운용 부서 목록."""
    return {"departments": config.DEPARTMENTS}


@app.post("/api/meetings/process")
async def process_meeting(
    audio: UploadFile = File(...),
    title: str = Form(""),
    participants: str = Form("[]"),
    emails: str = Form("[]"),
    duration_seconds: float = Form(0),
    department: str = Form(""),
    registrant: str = Form(""),
):
    # 부서와 등록자는 필수.
    department = department.strip()
    registrant = registrant.strip()
    if not department:
        return JSONResponse(status_code=400, content={"error": "부서를 선택해주세요."})
    if not registrant:
        return JSONResponse(status_code=400, content={"error": "등록자를 입력해주세요."})

    meeting_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    upload_date = datetime.now().strftime("%Y-%m-%d")
    safe_name = audio.filename or "meeting.webm"
    audio_path = config.RECORDINGS_DIR / f"{meeting_id}_{safe_name}"

    with audio_path.open("wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)

    participant_list = _parse_json_list(participants)
    email_list = _parse_json_list(emails)

    # 실제 처리(전사·요약·Notion)는 백그라운드에서 수행하고 즉시 job_id 를 돌려준다.
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "processing"}

    thread = threading.Thread(
        target=_run_meeting_job,
        args=(
            job_id,
            audio_path,
            title,
            participant_list,
            email_list,
            duration_seconds,
            meeting_id,
        ),
        kwargs={
            "department": department,
            "registrant": registrant,
            "upload_date": upload_date,
        },
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "processing", "meeting_id": meeting_id}


@app.get("/api/meetings/status/{job_id}")
def meeting_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"status": "not_found", "error": "작업을 찾을 수 없습니다."},
        )
    return job


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
