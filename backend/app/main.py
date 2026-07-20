import base64
import json
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import config
from app.services import auth as auth_svc
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


@app.middleware("http")
async def access_log(request: Request, call_next):
    """모든 API 요청을 로그로 남긴다. (status 폴링/로그 조회는 정상일 때 생략)"""
    start = time.time()
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001
        _log_event(
            "error",
            ip=(request.client.host if request.client else ""),
            method=request.method,
            path=request.url.path,
            error=f"{type(exc).__name__}: {exc}",
            user=_peek_email(request.headers.get("authorization") or ""),
        )
        raise
    path = request.url.path
    if path.startswith("/api") and request.method != "OPTIONS":
        noisy = path.startswith("/api/meetings/status/") or path.startswith("/api/logs")
        if (not noisy) or response.status_code >= 400:
            _log_event(
                "error" if response.status_code >= 400 else "access",
                ip=(request.client.host if request.client else ""),
                method=request.method,
                path=path,
                status=response.status_code,
                ms=int((time.time() - start) * 1000),
                user=_peek_email(request.headers.get("authorization") or ""),
            )
    return response


# ── 이용/에러 로그 (storage/logs/YYYYMMDD.jsonl, 호스트 볼륨에 보존) ────────
LOGS_DIR = config.STORAGE_DIR / "logs"


def _log_event(kind: str, **fields) -> None:
    """이용/에러 기록을 날짜별 JSONL 파일에 남긴다. 실패해도 앱 동작엔 영향 없음."""
    try:
        LOGS_DIR.mkdir(exist_ok=True)
        rec = {"ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, **fields}
        path = LOGS_DIR / (datetime.now().strftime("%Y%m%d") + ".jsonl")
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001
        pass


def _peek_email(auth_header: str) -> str:
    """로그용으로만 토큰에서 이메일을 꺼낸다(검증은 하지 않음 — 권한 판정에 쓰지 말 것)."""
    try:
        payload = auth_header.split(" ", 1)[1].split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return (data.get("email") or "").lower()
    except Exception:  # noqa: BLE001
        return ""


def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """구글 로그인 사용자. AUTH_ENABLED=false 면 None(무로그인). 켜졌는데 토큰 없거나
    유효하지 않으면 401/403."""
    if not config.AUTH_ENABLED:
        return None
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        user = auth_svc.verify_google_token(token)
    except Exception as exc:  # noqa: BLE001
        print(f"[auth] 토큰 검증 실패: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=401, detail="유효하지 않은 로그인입니다. 다시 로그인해주세요.")
    if not auth_svc.is_allowed(user["email"]):
        raise HTTPException(status_code=403, detail="접근이 허용되지 않은 계정입니다.")
    user.update(auth_svc.role_for(user["email"]))
    return user


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
    meeting_date: str = "",
    diarize: bool = True,
    summary_lang: str = "ko",
    creator_email: str = "",
    creator_name: str = "",
) -> None:
    try:
        segments: list[dict] = []
        with _transcribe_lock:
            try:
                segments, wav_path = transcribe_segments(audio_path)
                # 화자 분리(옵션, 실패해도 화자 없이 진행)
                if diarize:
                    try:
                        turns = diarize_svc.diarize(wav_path)
                        segments = diarize_svc.assign_speakers(segments, turns)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[diarize] 화자 분리 실패, 화자 없이 진행: {exc}")
                transcript = segments_to_text(segments)
            except Exception as exc:  # noqa: BLE001
                segments = []
                transcript = f"[00:00:00 - 00:00:01] 전사 처리 실패: {exc}"

        # 요약에는 화자 라벨(화자 N)을 뺀 전사본을 넘겨, Claude가 라벨을 참석자로
        # 오인하지 않고 대화 내용에서 실제 이름을 찾도록 한다.
        plain_transcript = segments_to_text(segments, include_speaker=False) if segments else transcript
        notes = summarize_transcript(
            plain_transcript, meeting_title=title, participants=participant_list, language=summary_lang
        )

        # 등장 순서대로 고유 화자 목록 → 대화 내용으로 참가자 추측 매핑(best-effort)
        speaker_labels: list[str] = []
        for seg in segments:
            sp = seg.get("speaker")
            if sp and sp not in speaker_labels:
                speaker_labels.append(sp)
        speaker_guess = guess_speaker_mapping(transcript, speaker_labels, participant_list)

        # 저장 대상 DB: 부서 DB(있으면) > 기본 DB
        target_db = config.NOTION_DB_BY_DEPARTMENT.get(department, "")

        duration_minutes = int(round((duration_seconds or 0) / 60))

        notion_url = ""
        notion_error = ""
        try:
            notion_url = upload_to_notion(
                notes,
                transcript,
                department=department,
                registrant=registrant,
                upload_date=upload_date,
                meeting_date=meeting_date,
                duration_minutes=duration_minutes,
                database_id=target_db,
            )
        except Exception as exc:  # noqa: BLE001
            notion_error = str(exc)

        # 대표/전체 DB에도 항상 저장(중복 대상이면 생략)
        effective_target = target_db or config.NOTION_DATABASE_ID
        if config.NOTION_ALL_DB and config.NOTION_ALL_DB != effective_target:
            try:
                upload_to_notion(
                    notes,
                    transcript,
                    department=department,
                    registrant=registrant,
                    upload_date=upload_date,
                    meeting_date=meeting_date,
                    duration_minutes=duration_minutes,
                    database_id=config.NOTION_ALL_DB,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[notion] 대표용 전체 DB 저장 실패: {exc}")

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
            "meeting_date": meeting_date,
            "creator_email": creator_email,
            "creator_name": creator_name,
            "email_sent": False,
            "email_error": "",
            "duration_seconds": duration_seconds,
            "requested_emails": email_list,
        }
        _save_result(meeting_id, result)
        if notion_error:
            _log_event("job-error", meeting_id=meeting_id, user=creator_email, registrant=registrant, error=f"Notion 저장 실패: {notion_error}")
        with _jobs_lock:
            _jobs[job_id] = {"status": "done", "result": result}
    except Exception as exc:  # noqa: BLE001
        _log_event("job-error", meeting_id=meeting_id, user=creator_email, registrant=registrant, error=f"{type(exc).__name__}: {exc}")
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


class ClientLogPayload(BaseModel):
    level: str = "error"
    message: str
    context: Optional[str] = ""


@app.post("/api/log/client")
def client_log(payload: ClientLogPayload, request: Request, authorization: Optional[str] = Header(None)):
    """프론트엔드(브라우저) 에러 수집. 로그인 전 실패도 받아야 하므로 인증 불요."""
    _log_event(
        "client-" + (payload.level or "error"),
        message=str(payload.message)[:2000],
        context=str(payload.context or "")[:500],
        user=_peek_email(authorization or ""),
        ip=(request.client.host if request.client else ""),
    )
    return {"ok": True}


@app.get("/api/logs/recent")
def logs_recent(limit: int = 300, errors_only: bool = False, user: Optional[dict] = Depends(get_current_user)):
    """최근 이용/에러 로그(최근 7일). 관리자만."""
    if config.AUTH_ENABLED and (not user or user.get("role") != "admin"):
        raise HTTPException(status_code=403, detail="관리자만 볼 수 있습니다.")
    rows: list[dict] = []
    if LOGS_DIR.exists():
        for f in sorted(LOGS_DIR.glob("*.jsonl"), reverse=True)[:7]:
            try:
                for line in f.read_text(encoding="utf-8").splitlines():
                    try:
                        rows.append(json.loads(line))
                    except Exception:  # noqa: BLE001
                        pass
            except Exception:  # noqa: BLE001
                continue
    if errors_only:
        rows = [r for r in rows if r.get("kind") != "access"]
    rows.sort(key=lambda r: r.get("ts", ""), reverse=True)
    return {"logs": rows[: max(1, min(limit, 1000))]}


@app.get("/api/auth/config")
def auth_config():
    """프론트가 로그인 필요 여부/Client ID 를 알 수 있게 공개."""
    return {"auth_enabled": config.AUTH_ENABLED, "google_client_id": config.GOOGLE_CLIENT_ID}


@app.get("/api/auth/me")
def auth_me(user: Optional[dict] = Depends(get_current_user)):
    """현재 로그인 사용자와 역할."""
    if not config.AUTH_ENABLED:
        return {"auth_enabled": False}
    return {"auth_enabled": True, **(user or {})}


@app.get("/api/meetings/list")
def meetings_list(user: Optional[dict] = Depends(get_current_user)):
    """앱 회의록 목록은 역할과 무관하게 '본인이 만든 것'만. 남의 것은 Notion에서 열람."""
    items = []
    for path in config.STORAGE_DIR.glob("*.json"):
        if path.name.endswith("_notes.json"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if config.AUTH_ENABLED and user and not auth_svc.is_own(user["email"], data):
            continue
        items.append({
            "meeting_id": data.get("meeting_id"),
            "title": (data.get("notes") or {}).get("title") or "회의록",
            "department": data.get("department") or "",
            "registrant": data.get("registrant") or "",
            "creator_email": data.get("creator_email") or "",
            "meeting_date": data.get("meeting_date") or "",
            "upload_date": data.get("upload_date") or "",
            "duration_seconds": data.get("duration_seconds") or 0,
            "notion_url": data.get("notion_url") or "",
        })
    items.sort(key=lambda x: str(x.get("meeting_id") or ""), reverse=True)
    return {"meetings": items, "count": len(items)}


@app.get("/api/meetings/detail/{meeting_id}")
def meeting_detail(meeting_id: str, user: Optional[dict] = Depends(get_current_user)):
    """회의록 전체 내용(요약·전사). 권한 있는 사람만."""
    path = config.STORAGE_DIR / f"{meeting_id}.json"
    if not path.exists():
        return JSONResponse(status_code=404, content={"error": "회의록을 찾을 수 없습니다."})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": "회의록을 읽을 수 없습니다."})
    if config.AUTH_ENABLED and user and not auth_svc.is_own(user["email"], data):
        raise HTTPException(status_code=403, detail="본인이 등록한 회의록만 앱에서 볼 수 있습니다. (다른 회의록은 Notion에서 확인)")
    return data


def _bump(d: dict, key: str, minutes: int) -> None:
    """{key: {count, minutes}} 누적."""
    e = d.setdefault(key, {"count": 0, "minutes": 0})
    e["count"] += 1
    e["minutes"] += minutes


def _to_sorted_list(d: dict) -> list:
    """{name:{count,minutes}} → [{name,count,minutes}] 건수 내림차순."""
    return sorted(
        [{"name": k, **v} for k, v in d.items()],
        key=lambda x: (x["count"], x["minutes"]),
        reverse=True,
    )


@app.get("/api/stats/monthly")
def monthly_stats(user: Optional[dict] = Depends(get_current_user)):
    """회의록 이용 통계(월별 + 등록자별 + 부서별). 권한에 맞는 기록만 집계."""
    months: dict[str, dict] = {}
    all_dept: dict[str, dict] = {}
    all_reg: dict[str, dict] = {}
    total_count = 0
    total_minutes = 0

    for path in config.STORAGE_DIR.glob("*.json"):
        if path.name.endswith("_notes.json"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if config.AUTH_ENABLED and user and not auth_svc.can_view(user["email"], data):
            continue

        meeting_id = str(data.get("meeting_id") or path.stem)
        upload_date = str(data.get("upload_date") or "")
        if len(upload_date) >= 7:
            month = upload_date[:7]
        elif len(meeting_id) >= 6 and meeting_id[:6].isdigit():
            month = f"{meeting_id[:4]}-{meeting_id[4:6]}"
        else:
            month = "기타"

        minutes = int(round((data.get("duration_seconds") or 0) / 60))
        dept = data.get("department") or "미지정"
        reg = data.get("registrant") or "미지정"

        total_count += 1
        total_minutes += minutes
        _bump(all_dept, dept, minutes)
        _bump(all_reg, reg, minutes)

        b = months.setdefault(month, {"month": month, "count": 0, "minutes": 0, "by_department": {}, "by_registrant": {}})
        b["count"] += 1
        b["minutes"] += minutes
        _bump(b["by_department"], dept, minutes)
        _bump(b["by_registrant"], reg, minutes)

    month_list = []
    for m in sorted(months.values(), key=lambda x: x["month"], reverse=True):
        month_list.append({
            "month": m["month"],
            "count": m["count"],
            "minutes": m["minutes"],
            "by_department": _to_sorted_list(m["by_department"]),
            "by_registrant": _to_sorted_list(m["by_registrant"]),
        })

    return {
        "total_count": total_count,
        "total_minutes": total_minutes,
        "by_department": _to_sorted_list(all_dept),
        "by_registrant": _to_sorted_list(all_reg),
        "months": month_list,
    }


@app.post("/api/meetings/process")
async def process_meeting(
    audio: UploadFile = File(...),
    title: str = Form(""),
    participants: str = Form("[]"),
    emails: str = Form("[]"),
    duration_seconds: float = Form(0),
    department: str = Form(""),
    registrant: str = Form(""),
    meeting_date: str = Form(""),
    diarize: bool = Form(True),
    summary_lang: str = Form("ko"),
    user: Optional[dict] = Depends(get_current_user),
):
    # 부서와 등록자는 필수.
    department = department.strip()
    registrant = registrant.strip()
    meeting_date = meeting_date.strip()
    creator_email = (user or {}).get("email", "")
    creator_name = (user or {}).get("name", "")
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
            "meeting_date": meeting_date,
            "diarize": diarize,
            "summary_lang": summary_lang,
            "creator_email": creator_email,
            "creator_name": creator_name,
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
