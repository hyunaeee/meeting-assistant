import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app import config


def send_meeting_email(recipients: list[str], notes: dict, notion_url: str = "") -> None:
    if not recipients:
        return
    if not config.SMTP_USER or not config.SMTP_PASSWORD:
        raise RuntimeError("SMTP_USER 또는 SMTP_PASSWORD가 .env에 없습니다.")

    subject = "[LIKE meeting assistant] " + notes.get("title", "회의록")
    body = _build_body(notes, notion_url)

    msg = MIMEMultipart()
    msg["From"] = config.SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
        server.starttls()
        server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.sendmail(config.SMTP_FROM or config.SMTP_USER, recipients, msg.as_string())


def _build_body(notes: dict, notion_url: str) -> str:
    lines = []
    lines.append(notes.get("title", "회의록"))
    lines.append("")
    if notion_url:
        lines.append(f"Notion 링크: {notion_url}")
        lines.append("")
    attendees = notes.get("attendees") or []
    if attendees:
        lines.append("참석자")
        for attendee in attendees:
            lines.append(f"- {attendee}")
        lines.append("")
    lines.append("요약")
    lines.append(notes.get("summary", ""))
    lines.append("")
    for section_key, label in [
        ("agenda", "안건"),
        ("key_points", "핵심 논의"),
        ("decisions", "결정사항"),
        ("open_questions", "추가 논의 필요"),
    ]:
        items = notes.get(section_key) or []
        if items:
            lines.append(label)
            for item in items:
                lines.append(f"- {item}")
            lines.append("")
    action_items = notes.get("action_items") or []
    if action_items:
        lines.append("액션 아이템")
        for item in action_items:
            lines.append(f"- {item.get('task', '')} (담당: {item.get('owner', '미정')} / 기한: {item.get('due', '미정')})")
    return "\n".join(lines)
