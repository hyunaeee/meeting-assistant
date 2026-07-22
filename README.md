# LIKE meeting assistant

### 👉 [데모 사이트 둘러보기](https://hyunaeee.github.io/meeting-assistant/)

설치 없이 브라우저에서 바로 UI를 체험할 수 있습니다. 로그인 화면에서 **"데모로 둘러보기"** 를 누르면
회의록 목록·상세 보기·이용 통계·로그까지 실제 화면 그대로 볼 수 있습니다.
데모는 가짜 데이터로만 동작하며 서버로 아무것도 전송하지 않습니다. (전사·요약·Notion 저장은 실제 배포판에서만 동작)

<img width="1172" height="1128" alt="image" src="https://github.com/user-attachments/assets/c9ae9d93-b97a-4ba3-b010-e24f5e16d953" />


기존 `meeting-notes` 로컬 CLI 흐름을 웹 UI + Docker 형태로 확장한 버전입니다.

## 주요 기능

- **구글 SSO 로그인** — 회사 계정만 접속. 별도 가입 없음
- **권한 분리** — 앱에서는 본인이 만든 회의록만 열람. 부서(본부)별 Notion DB로 분리 저장하고, 대표/관리자용 통합 DB에도 함께 기록
- **전사** — faster-whisper large-v3 (CUDA/float16), 회의별 전사 언어 선택(한국어 기본 / English / 자동 감지)
- **화자 분리** — pyannote 3.1 청크 방식으로 56분 파일 약 28초 처리, AI가 화자 이름까지 추정
- **회의록 자동 생성** — Claude가 요약·안건·핵심 논의·결정사항·액션 아이템으로 정리, 회의록 언어 선택 가능
- **이용 통계 / 로그** — 등록자별·부서별·월별 통계, 관리자 전용 이용·에러 로그 뷰어

핵심 흐름은 다음과 같습니다.

```txt
브라우저 녹음 또는 오디오 파일 업로드
→ backend/app/recordings 에 원본 저장
→ faster-whisper large-v3 / CUDA / float16 전사
→ Claude Sonnet 4.6으로 회의록 JSON 생성
→ Notion 자동 저장
→ 이메일 입력 시 SMTP로 회의록 링크/요약 전달
```

## 실행

루트 폴더에서 실행합니다.

```bash
docker compose up --build
```

접속 주소:

```txt
프론트: http://localhost:5173
백엔드: http://localhost:8000
상태 확인: http://localhost:8000/health
```

## .env 설정

루트의 `.env` 파일을 수정합니다. 일반 사용자는 건드리지 않고, 관리자/개발자가 한 번만 설정하는 방식입니다.

```env
# Claude
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MAX_TOKENS=4096

# Notion
# 기존 meeting-notes 방식과 맞추기 위해 NOTION_TOKEN을 기본으로 씁니다.
NOTION_TOKEN=ntn_...
NOTION_API_KEY=

# 우선순위: NOTION_DATABASE_ID가 있으면 DB 저장, 없으면 NOTION_PAGE_ID 아래에 저장
NOTION_DATABASE_ID=
NOTION_PAGE_ID=노션_페이지_ID
NOTION_DEFAULT_LOCATION=LIKE Meeting Minutes
NOTION_VERSION=2025-09-03

# Whisper / GPU
WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
WHISPER_LANGUAGE=ko

# Email SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=발송이메일@gmail.com
SMTP_PASSWORD=구글_앱_비밀번호
SMTP_FROM=LIKE meeting assistant <발송이메일@gmail.com>

# Hugging Face speaker diarization 준비값
HF_TOKEN=

# App
BACKEND_PORT=8000
FRONTEND_PORT=5173
VITE_API_BASE_URL=http://localhost:8000
```

## Notion 설정

### 추천 MVP: 페이지 하나에 하위 페이지로 저장

1. Notion에 `LIKE Meeting Minutes` 페이지 생성
2. Notion Integration 생성
3. 해당 페이지 우측 상단 `...` 또는 `Connections`에서 Integration 연결
4. 페이지 URL에서 page ID 복사
5. `.env`의 `NOTION_PAGE_ID`에 입력

이 방식은 DB 스키마가 필요 없어서 일반 사용자에게 가장 안정적입니다. 회의록마다 해당 페이지 아래에 새 하위 페이지가 생성됩니다.

### 기존 meeting-notes 방식: 데이터베이스에 저장

기존 코드처럼 Notion DB에 넣고 싶으면 `.env`에 `NOTION_DATABASE_ID`를 넣습니다.

```env
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

DB는 title 속성 하나만 있어도 됩니다. 백엔드가 DB의 data source와 title 속성을 찾아 회의록 페이지를 생성하고, 본문 블록으로 요약/참석자/안건/결정사항/액션 아이템/전사본을 넣습니다.

저장 우선순위:

```txt
1. NOTION_DATABASE_ID가 있으면 DB/data_source에 저장
2. NOTION_DATABASE_ID가 비어 있고 NOTION_PAGE_ID가 있으면 페이지 아래에 저장
```

## 브라우저 녹음

- 온라인 회의: `온라인 회의` 선택 후 `회의 시작` → Chrome/Edge의 화면/탭 공유 창에서 오디오 공유 체크
- 오프라인 회의: `오프라인 회의` 선택 후 `회의 시작` → 마이크 권한 허용
- 파일 처리: `오디오 파일 선택`으로 기존 wav/mp3/webm/mp4 파일 업로드 가능

## 결과 저장 파일

백엔드는 기존 CLI처럼 결과 파일도 남깁니다.

```txt
backend/app/recordings/          원본 녹음/업로드 파일
backend/app/storage/<id>.json    전체 처리 결과
backend/app/storage/<id>_notes.json       Claude 회의록 JSON
backend/app/storage/<id>_transcript.txt   Whisper 전사본
```

## Claude SYSTEM_PROMPT

`backend/app/services/claude.py`에 회의록 JSON 전용 프롬프트가 들어 있습니다.

반환 JSON 구조:

```json
{
  "title": "회의 주제를 한 줄로 요약",
  "summary": "회의 전체를 3~5문장으로 요약",
  "attendees": [],
  "agenda": [],
  "key_points": [],
  "decisions": [],
  "action_items": [
    {"task": "할 일 내용", "owner": "담당자", "due": "기한"}
  ],
  "open_questions": []
}
```

## GPU 확인

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```

컨테이너 안에서 4090이 보여야 `WHISPER_DEVICE=cuda`가 정상 동작합니다.

## 문제 해결

### Notion 저장 실패

- `NOTION_TOKEN` 값 확인
- `NOTION_PAGE_ID` 또는 `NOTION_DATABASE_ID` 확인
- 해당 페이지/DB에 Integration이 연결되어 있는지 확인

### Gmail 발송 실패

- Gmail 로그인 비밀번호가 아니라 앱 비밀번호 사용
- Google 계정 2단계 인증 필요

### 온라인 회의 녹음이 비어 있음

- Chrome/Edge에서 탭 공유 권장
- 공유 창에서 오디오 공유 체크 필요

## 오디오 테스트 후 회의 시작

이번 버전은 회의 시작 전에 오디오 입력을 먼저 확인합니다.

1. 온라인 회의 또는 오프라인 회의를 선택합니다.
2. `오디오 테스트` 버튼을 누릅니다.
3. 온라인 회의는 브라우저 공유 창에서 오디오 공유를 켭니다.
4. 오프라인 회의는 마이크 권한을 허용하고 말소리가 들어오는지 확인합니다.
5. 레벨 바가 움직이고 `인식 완료`가 표시되면 `회의 시작` 버튼이 활성화됩니다.

소리가 감지되지 않으면 회의 시작 버튼이 비활성화됩니다. 이 경우 스피커/마이크 연결, 브라우저 권한, 탭 오디오 공유 옵션을 확인하세요.

## Frontend Docker troubleshooting

If the frontend logs `sh: vite: not found`, rebuild the frontend image without cache:

```bash
docker compose down
docker compose build --no-cache frontend
docker compose up
```

The frontend Dockerfile installs Vite inside the image and verifies it with `npm ls vite` during build.

### `No module named requests` 오류

이 오류는 백엔드 이미지에 `requests` 패키지가 빠졌을 때 발생합니다. 이번 버전에는 `backend/requirements.txt`에 `requests==2.32.3`가 포함되어 있습니다. 기존 Docker 캐시가 남아 있으면 아래처럼 캐시 없이 다시 빌드하세요.

```bash
docker compose down
docker compose build --no-cache backend
docker compose up
```

## 2026-05 update: 온라인 회의 녹음 개선

- 온라인 회의 모드에서 탭/시스템 오디오와 내 마이크 입력을 Web Audio API로 합쳐서 녹음합니다.
- 오디오 테스트 단계에서 화면/탭 오디오 공유와 마이크 권한을 모두 확인합니다.
- 회의록 생성 중에는 일반 사용자도 이해할 수 있도록 진행 상황 로그가 화면에 표시됩니다.
  - 녹음 파일 준비
  - 서버 전송
  - 오디오 변환
  - Whisper 전사
  - Claude 요약
  - Notion 저장
  - 이메일 전달

온라인 회의 모드에서는 Chrome/Edge에서 회의가 열려 있는 브라우저 탭을 공유하고, 공유 창의 오디오 공유 옵션을 반드시 켜주세요.

## 이번 버전 변경 사항

- 온라인 회의 모드에서 탭/시스템 오디오와 내 마이크를 함께 믹싱해 녹음합니다.
- 회의록 생성 중 사용자용 진행 상황을 표시합니다.
- 회의 길이를 `N시간 N분 N초` 형태로 표시하고, 서버에도 `duration_seconds`로 전달합니다.
- 회의록 생성 및 Notion 자동 저장이 끝난 뒤에도, 사용자가 원하면 결과 화면에서 이메일을 보낼 수 있습니다.
- 이메일은 회의 설정에서 미리 추가해도 되고, 회의록 생성 후 추가한 다음 `이메일 보내기` 버튼을 눌러 전송할 수 있습니다.

이메일은 자동 발송되지 않습니다. Notion 저장 완료 후 결과 화면에서 사용자가 직접 `이메일 보내기`를 눌러야 발송됩니다.
