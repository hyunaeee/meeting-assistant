"""전역 설정"""
import json
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).parent
RECORDINGS_DIR = ROOT_DIR / "recordings"
STORAGE_DIR = ROOT_DIR / "storage"
RECORDINGS_DIR.mkdir(exist_ok=True)
STORAGE_DIR.mkdir(exist_ok=True)

SAMPLE_RATE = 16000
CHANNELS = 1

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "ko")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
CLAUDE_MAX_TOKENS = int(os.getenv("CLAUDE_MAX_TOKENS", "4096"))

NOTION_TOKEN = os.getenv("NOTION_TOKEN") or os.getenv("NOTION_API_KEY", "")
NOTION_PAGE_ID = os.getenv("NOTION_PAGE_ID", "")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID", "")
NOTION_DEFAULT_LOCATION = os.getenv("NOTION_DEFAULT_LOCATION", "LIKE Meeting Minutes")
NOTION_VERSION = os.getenv("NOTION_VERSION", "2025-09-03")


def _load_notion_targets() -> list[dict]:
    """저장 가능한 Notion 대상 목록.

    .env 의 NOTION_TARGETS(JSON 배열)를 우선 사용한다. 예)
      NOTION_TARGETS=[{"key":"team","label":"팀 회의록","database_id":"..."},
                      {"key":"personal","label":"개인 회의록","database_id":"..."}]
    각 항목은 database_id 또는 page_id 중 하나를 가진다.
    설정이 없으면 기존 단일 NOTION_DATABASE_ID/PAGE_ID 로 대상 하나를 만든다(하위호환).
    """
    raw = os.getenv("NOTION_TARGETS", "").strip()
    if raw:
        try:
            targets = []
            for item in json.loads(raw):
                key = str(item.get("key") or "").strip()
                if not key:
                    continue
                targets.append({
                    "key": key,
                    "label": str(item.get("label") or key).strip(),
                    "database_id": str(item.get("database_id") or "").strip(),
                    "page_id": str(item.get("page_id") or "").strip(),
                })
            if targets:
                return targets
        except Exception:
            pass

    if NOTION_DATABASE_ID or NOTION_PAGE_ID:
        return [{
            "key": "default",
            "label": NOTION_DEFAULT_LOCATION or "회의록",
            "database_id": NOTION_DATABASE_ID,
            "page_id": NOTION_PAGE_ID,
        }]
    return []


NOTION_TARGETS = _load_notion_targets()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER

HF_TOKEN = os.getenv("HF_TOKEN", "")
