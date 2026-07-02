"""전역 설정"""
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

# 부서 선택지 (드롭다운). 필요하면 .env NOTION_DEPARTMENTS 로 콤마 구분 재정의 가능.
DEPARTMENTS = [
    d.strip()
    for d in os.getenv("NOTION_DEPARTMENTS", "교육부,개발부").split(",")
    if d.strip()
]

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER

HF_TOKEN = os.getenv("HF_TOKEN", "")
