"""구글 로그인(ID 토큰) 검증 + 역할/권한 판정."""
from app import config


def verify_google_token(id_token_str: str) -> dict:
    """구글 ID 토큰을 검증하고 {email, name} 반환. 실패 시 예외."""
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    info = google_id_token.verify_oauth2_token(
        id_token_str,
        google_requests.Request(),
        config.GOOGLE_CLIENT_ID or None,
    )
    email = (info.get("email") or "").strip().lower()
    if not email:
        raise ValueError("이메일이 없는 토큰입니다.")
    if not info.get("email_verified", True):
        raise ValueError("이메일이 인증되지 않았습니다.")
    return {"email": email, "name": info.get("name") or email}


def is_allowed(email: str) -> bool:
    """로그인 허용 대상인지(도메인/개별 이메일)."""
    email = (email or "").strip().lower()
    if not email:
        return False
    if email in config.EXTRA_ALLOWED_EMAILS or email in config.CEO_EMAILS or email in config.ADMIN_EMAILS:
        return True
    if email in config.DEPARTMENT_HEADS:
        return True
    if config.ALLOWED_EMAIL_DOMAIN:
        return email.endswith("@" + config.ALLOWED_EMAIL_DOMAIN)
    return True  # 도메인 제한이 없으면 허용


def role_for(email: str) -> dict:
    """역할 판정. {'role': 'admin'|'ceo'|'head'|'user', 'department': str|None}"""
    email = (email or "").strip().lower()
    if email in config.ADMIN_EMAILS:
        return {"role": "admin", "department": None}
    if email in config.CEO_EMAILS:
        return {"role": "ceo", "department": None}
    if email in config.DEPARTMENT_HEADS:
        return {"role": "head", "department": config.DEPARTMENT_HEADS[email]}
    return {"role": "user", "department": None}


def can_view(user_email: str, record: dict) -> bool:
    """이 사용자가 해당 회의록 기록을 볼 수 있는지."""
    email = (user_email or "").strip().lower()
    role = role_for(email)
    if role["role"] in ("admin", "ceo"):
        return True
    if role["role"] == "head":
        return (record.get("department") or "") == role["department"]
    # 일반: 본인이 만든 것만
    return (record.get("creator_email") or "").strip().lower() == email
