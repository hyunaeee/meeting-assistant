"""
회의록 dict를 Notion에 업로드합니다.
- NOTION_DATABASE_ID가 있으면 Notion 데이터베이스/data_source에 페이지 생성
- NOTION_DATABASE_ID가 없고 NOTION_PAGE_ID가 있으면 해당 페이지 아래에 하위 페이지 생성
Notion 2025+ data_source 모델을 우선 지원합니다.
"""
from datetime import datetime
from typing import Any

import httpx
from notion_client import Client
from app import config

NOTION_API = "https://api.notion.com/v1"
_client = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not config.NOTION_TOKEN:
            raise RuntimeError("NOTION_TOKEN 또는 NOTION_API_KEY가 .env에 없습니다.")
        _client = Client(auth=config.NOTION_TOKEN, notion_version=config.NOTION_VERSION)
    return _client


def _http_headers() -> dict[str, str]:
    if not config.NOTION_TOKEN:
        raise RuntimeError("NOTION_TOKEN 또는 NOTION_API_KEY가 .env에 없습니다.")
    return {
        "Authorization": f"Bearer {config.NOTION_TOKEN}",
        "Notion-Version": config.NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _get_data_source_id(db_id: str) -> tuple[str, str]:
    r = httpx.get(f"{NOTION_API}/databases/{db_id}", headers=_http_headers(), timeout=60)
    r.raise_for_status()
    db_data = r.json()

    data_sources = db_data.get("data_sources", [])
    if not data_sources:
        # 구버전/환경 대응: database_id parent로 직접 생성할 때 쓸 title prop 탐색
        title_prop = None
        for name, info in db_data.get("properties", {}).items():
            if info.get("type") == "title":
                title_prop = name
                break
        if title_prop:
            return db_id, title_prop
        raise RuntimeError("DB에 data source가 없습니다. Notion 데이터베이스를 다시 확인하세요.")

    ds_id = data_sources[0]["id"]
    r = httpx.get(f"{NOTION_API}/data_sources/{ds_id}", headers=_http_headers(), timeout=60)
    r.raise_for_status()
    ds_data = r.json()

    title_prop = None
    for name, info in ds_data.get("properties", {}).items():
        if info.get("type") == "title":
            title_prop = name
            break

    if not title_prop:
        raise RuntimeError("data source에 title 속성이 없습니다.")

    return ds_id, title_prop


def _rich_text(text: str) -> list[dict[str, Any]]:
    safe = str(text or "")[:1900]
    return [{"type": "text", "text": {"content": safe}}]


def _h2(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "heading_2", "heading_2": {"rich_text": _rich_text(text)}}


def _para(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rich_text(text)}}


def _bullet(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": _rich_text(text)}}


def _todo(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "to_do", "to_do": {"rich_text": _rich_text(text), "checked": False}}


def _toggle(title: str, child_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {"object": "block", "type": "toggle", "toggle": {"rich_text": _rich_text(title), "children": child_blocks}}


def _create_database_page(ds_id: str, title_prop: str, title: str, children: list[dict[str, Any]]) -> dict[str, Any]:
    body = {
        "parent": {"type": "data_source_id", "data_source_id": ds_id},
        "properties": {title_prop: {"title": [{"text": {"content": title}}]}},
        "children": children,
    }
    r = httpx.post(f"{NOTION_API}/pages", headers=_http_headers(), json=body, timeout=60)
    if r.status_code >= 400:
        # 일부 워크스페이스가 data_source parent를 아직 받지 못할 때 database_id parent fallback
        fallback = {
            "parent": {"database_id": ds_id},
            "properties": {title_prop: {"title": [{"text": {"content": title}}]}},
            "children": children,
        }
        r = httpx.post(f"{NOTION_API}/pages", headers=_http_headers(), json=fallback, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"페이지 생성 실패 [{r.status_code}]: {r.text}")
    return r.json()


def _create_child_page(parent_page_id: str, title: str, children: list[dict[str, Any]]) -> dict[str, Any]:
    body = {
        "parent": {"type": "page_id", "page_id": parent_page_id},
        "properties": {"title": {"title": [{"text": {"content": title}}]}},
        "children": children,
    }
    r = httpx.post(f"{NOTION_API}/pages", headers=_http_headers(), json=body, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"하위 페이지 생성 실패 [{r.status_code}]: {r.text}")
    return r.json()


def _append_blocks(page_id: str, blocks: list[dict[str, Any]]) -> None:
    for i in range(0, len(blocks), 100):
        body = {"children": blocks[i:i + 100]}
        r = httpx.patch(f"{NOTION_API}/blocks/{page_id}/children", headers=_http_headers(), json=body, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"블록 추가 실패 [{r.status_code}]: {r.text}")


def _split_text(text: str, size: int) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)]


def _build_blocks(notes: dict[str, Any], transcript: str = "") -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []

    if notes.get("summary"):
        blocks.append(_h2("📝 요약"))
        blocks.append(_para(notes["summary"]))

    if notes.get("attendees"):
        blocks.append(_h2("👥 참석자"))
        for attendee in notes["attendees"]:
            blocks.append(_bullet(str(attendee)))

    if notes.get("agenda"):
        blocks.append(_h2("📌 안건"))
        for agenda in notes["agenda"]:
            blocks.append(_bullet(str(agenda)))

    if notes.get("key_points"):
        blocks.append(_h2("💡 핵심 논의"))
        for point in notes["key_points"]:
            blocks.append(_bullet(str(point)))

    if notes.get("decisions"):
        blocks.append(_h2("✅ 결정사항"))
        for decision in notes["decisions"]:
            blocks.append(_bullet(str(decision)))

    if notes.get("action_items"):
        blocks.append(_h2("🎯 액션 아이템"))
        for item in notes["action_items"]:
            task = item.get("task", "") if isinstance(item, dict) else str(item)
            owner = item.get("owner", "미정") if isinstance(item, dict) else "미정"
            due = item.get("due", "미정") if isinstance(item, dict) else "미정"
            blocks.append(_todo(f"{task} (담당: {owner} / 기한: {due})"))

    if notes.get("open_questions"):
        blocks.append(_h2("❓ 추가 논의 필요"))
        for question in notes["open_questions"]:
            blocks.append(_bullet(str(question)))

    if transcript:
        transcript_blocks = [_para(chunk) for chunk in _split_text(transcript, 1900)]
        blocks.append(_toggle("📜 전체 전사본", transcript_blocks[:100]))

    return blocks or [_para("회의록 내용이 없습니다.")]


def upload(
    notes: dict[str, Any],
    transcript: str = "",
    database_id: str = "",
    page_id: str = "",
) -> str:
    # 대상 미지정 시 기존 .env 기본값을 사용한다(하위호환).
    if not database_id and not page_id:
        database_id = config.NOTION_DATABASE_ID
        page_id = config.NOTION_PAGE_ID

    title = notes.get("title") or f"회의록 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    blocks = _build_blocks(notes, transcript)

    if database_id:
        ds_id, title_prop = _get_data_source_id(database_id)
        page = _create_database_page(ds_id, title_prop, title, blocks[:100])
    elif page_id:
        page = _create_child_page(page_id, title, blocks[:100])
    else:
        raise RuntimeError("저장할 Notion 대상(database_id/page_id)이 없습니다.")

    page_id = page["id"]
    if len(blocks) > 100:
        _append_blocks(page_id, blocks[100:])

    return page.get("url", "")
