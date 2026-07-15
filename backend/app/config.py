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
# 비우면 자동 감지(영어 회의는 영어로, 한국어 회의는 한국어로 전사)
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "")
# 전사 속도/정확도 트레이드오프. 1이면 빠름(그리디), 5면 느리고 약간 정확.
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))

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


def _load_db_by_department() -> dict[str, str]:
    """부서(본부)별 Notion DB 매핑. 부서마다 DB를 나눠 접근권한을 분리한다.
    .env 예) NOTION_DB_BY_DEPARTMENT={"교육부":"db_id_1","개발부":"db_id_2"}
    매핑에 없는 부서는 기본 NOTION_DATABASE_ID 로 저장된다.
    """
    raw = os.getenv("NOTION_DB_BY_DEPARTMENT", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return {str(k): str(v).strip() for k, v in data.items() if str(v).strip()}
    except Exception:
        return {}


NOTION_DB_BY_DEPARTMENT = _load_db_by_department()


def _load_json_map(name: str) -> dict:
    raw = os.getenv(name, "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# 대표/전체용 DB. 모든 회의록이 (부서·프로젝트 DB와 별개로) 여기에도 저장된다.
NOTION_ALL_DB = os.getenv("NOTION_ALL_DB", "").strip()

# 부서별 프로젝트 선택지: {"부서": ["프로젝트A", "프로젝트B"]}. (드롭다운용, 아직 비어있음)
NOTION_PROJECTS_BY_DEPARTMENT = _load_json_map("NOTION_PROJECTS_BY_DEPARTMENT")

# 프로젝트별 DB 매핑: {"부서": {"프로젝트A": "db_id"}}. (라우팅용, 주소는 나중에 채움)
NOTION_DB_BY_PROJECT = _load_json_map("NOTION_DB_BY_PROJECT")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER

HF_TOKEN = os.getenv("HF_TOKEN", "")

# 화자분리: 긴 오디오는 클러스터링이 O(n²)로 폭발하므로 청크로 나눠 처리 후 화자 병합.
DIARIZE_CHUNK_SEC = int(os.getenv("DIARIZE_CHUNK_SEC", "300"))          # 청크 길이(초)
DIARIZE_MERGE_THRESHOLD = float(os.getenv("DIARIZE_MERGE_THRESHOLD", "0.5"))  # 화자 병합 코사인 유사도 기준
