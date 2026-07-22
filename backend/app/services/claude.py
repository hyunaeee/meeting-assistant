import json
import re
from typing import Any
from anthropic import Anthropic
from app import config

SYSTEM_PROMPT = """당신은 회의록 정리 전문가입니다.
주어진 회의 음성 전사본(타임스탬프 포함)을 분석해서 구조화된 회의록 JSON을 생성합니다.

반드시 다음 JSON 스키마로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:

{
  "title": "회의 주제를 한 줄로 요약 (예: '2026 Q2 마케팅 전략 킥오프')",
  "summary": "회의 전체를 3~5문장으로 요약",
  "attendees": ["참석자1", "참석자2"],
  "agenda": ["다룬 안건1", "다룬 안건2"],
  "key_points": [
    "핵심 논의사항 1 (구체적으로)",
    "핵심 논의사항 2"
  ],
  "decisions": [
    "결정된 사항 1",
    "결정된 사항 2"
  ],
  "action_items": [
    {"task": "할 일 내용", "owner": "담당자 (불명확하면 미정)", "due": "기한 (없으면 미정)"}
  ],
  "open_questions": [
    "결론 안 난 이슈나 추가 논의 필요 사항"
  ]
}

규칙:
- 참석자 이름이 transcript에서 명확하지 않으면 빈 배열 반환
- 추측하지 말고 transcript에 있는 내용만 사용
- 출력 언어는 사용자 프롬프트의 지시를 따른다
- key_points와 decisions는 명확히 구분 (논의 vs 합의)
"""

EMPTY_NOTES = {
    "title": "회의록",
    "summary": "요약을 생성하지 못했습니다.",
    "attendees": [],
    "agenda": [],
    "key_points": [],
    "decisions": [],
    "action_items": [],
    "open_questions": [],
}


SPEAKER_MAP_SYSTEM = """당신은 회의 전사본에서 각 화자가 실제로 누구인지 추정하는 전문가입니다.
화자 라벨(화자 1, 화자 2 ...)마다 대화 내용을 근거로 가장 가능성 높은 인물을 추정하세요.
- 사용자가 제공한 참석자 목록이 있으면 그 중에서 우선 매칭합니다.
- 목록에 없거나 애매하면, 대화에서 드러난 이름/호칭/역할(예: "김부장", "진행자")을 사용합니다.
- 추정 근거가 전혀 없으면 그 화자는 결과에서 생략합니다.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 금지:
{"화자 1": "추정이름", "화자 2": "추정이름"}
"""


def guess_speaker_mapping(transcript: str, speakers: list[str], participants: list[str] | None = None) -> dict[str, str]:
    """각 화자 라벨에 대한 추정 인물명을 반환한다(best-effort). 실패 시 빈 dict."""
    if not config.ANTHROPIC_API_KEY or not speakers or not transcript.strip():
        return {}
    try:
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
        user_prompt = (
            f"참석자 목록: {', '.join(participants or []) or '없음'}\n"
            f"화자 목록: {', '.join(speakers)}\n\n"
            f"전사본:\n{transcript}"
        )
        message = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=500,
            system=SPEAKER_MAP_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
        data = _json_from_text(text)
        if not isinstance(data, dict):
            return {}
        return {
            str(k): str(v).strip()
            for k, v in data.items()
            if k in speakers and str(v).strip()
        }
    except Exception:
        return {}


def _json_from_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    return json.loads(stripped)


def summarize_transcript(transcript: str, meeting_title: str = "", participants: list[str] | None = None, language: str = "ko") -> dict[str, Any]:
    if not config.ANTHROPIC_API_KEY:
        notes = dict(EMPTY_NOTES)
        notes["title"] = meeting_title or "회의록"
        notes["summary"] = "ANTHROPIC_API_KEY가 설정되지 않아 샘플 요약으로 저장되었습니다."
        notes["attendees"] = participants or []
        notes["key_points"] = ["전사본은 생성되었지만 Claude 요약 API 키가 없어 구조화 요약을 생성하지 못했습니다."]
        return notes

    lang_instruction = (
        "Write ALL meeting-note content (title, summary, agenda, key_points, decisions, "
        "action items, open_questions, etc.) in ENGLISH, regardless of the transcript's language."
        if language == "en"
        else "회의록의 모든 내용(제목·요약·안건·핵심논의·결정사항·액션아이템 등)을 한국어로 작성하세요."
    )

    client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    user_prompt = f"""
회의 제목 후보: {meeting_title or "없음"}
사용자가 UI에서 명시 입력한 참석자 목록: {", ".join(participants or []) or "없음"}

출력 언어 지시: {lang_instruction}

참석자 목록이 제공된 경우 transcript에 직접 언급되지 않아도 회의 메타데이터로 간주하여 attendees에 반드시 포함하세요.
아래 전사본을 분석해서 지정된 JSON 스키마로만 응답하세요.

전사본:
{transcript}
"""
    message = client.messages.create(
        model=config.CLAUDE_MODEL,
        max_tokens=config.CLAUDE_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
    notes = _json_from_text(text)

    if meeting_title and (not notes.get("title") or notes.get("title") == "회의록"):
        notes["title"] = meeting_title
    existing_attendees = notes.get("attendees") or []
    merged_attendees = []
    for name in [*(participants or []), *existing_attendees]:
        value = str(name).strip()
        # "화자 1" 같은 자동 라벨은 실제 참석자가 아니므로 제외
        if not value or re.fullmatch(r"화자\s*\d+", value):
            continue
        if value not in merged_attendees:
            merged_attendees.append(value)
    notes["attendees"] = merged_attendees
    return notes
