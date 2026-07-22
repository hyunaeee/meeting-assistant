/**
 * 데모 모드용 가짜 백엔드.
 *
 * GitHub Pages 처럼 백엔드가 없는 곳에서도 앱을 그대로 둘러볼 수 있도록
 * window.fetch 를 가로채 /api/* 요청에 미리 준비한 응답을 돌려준다.
 * App.jsx 는 전혀 수정하지 않으므로 데모 화면이 실제 앱과 항상 같다.
 *
 * 여기 들어가는 데이터는 전부 가공의 예시다. 실제 회의 내용이 아니다.
 */

const DEPARTMENTS = ["교육사업본부", "개발사업본부"];

const NOTES = {
  title: "3분기 신규 교육 플랫폼 킥오프",
  summary:
    "신규 교육 플랫폼의 3분기 개발 범위와 일정을 확정했다. MVP 범위를 수강 신청과 진도 관리로 좁히고, " +
    "결제 연동은 4분기로 미루기로 했다. 디자인 시안은 다음 주 화요일까지 공유하기로 합의했다.",
  attendees: ["김개발", "이교육", "박기획", "최운영"],
  agenda: ["3분기 개발 범위 확정", "일정 및 마일스톤", "디자인 시안 공유 방식", "결제 연동 시점"],
  key_points: [
    "MVP 범위를 수강 신청 + 진도 관리 두 가지로 한정하기로 했다.",
    "결제 연동은 PG사 심사 기간이 3주 이상 걸려 3분기 내 완료가 어렵다고 판단했다.",
    "디자인 시안은 Figma 링크로 공유하고, 피드백은 코멘트로 남기기로 했다.",
    "QA 기간을 최소 2주 확보해야 오픈 일정을 지킬 수 있다는 의견이 나왔다.",
  ],
  decisions: [
    "3분기 MVP 범위는 수강 신청과 진도 관리로 확정한다.",
    "결제 연동은 4분기로 이관한다.",
    "오픈 목표일은 9월 30일로 잡되, QA 2주를 역산해 9월 15일 기능 동결한다.",
  ],
  open_questions: [
    "모바일 앱 대응을 3분기에 포함할지 여부는 다음 회의에서 재논의",
    "기존 수강생 데이터 이관 방식 미정",
  ],
  action_items: [
    { task: "디자인 시안 Figma 공유", owner: "박기획", due: "다음 주 화요일" },
    { task: "PG사 심사 일정 확인 후 공유", owner: "최운영", due: "이번 주 금요일" },
    { task: "진도 관리 API 명세 초안 작성", owner: "김개발", due: "8월 첫째 주" },
  ],
};

const SEGMENTS = [
  { start: 0.0, end: 6.4, text: "네, 그럼 3분기 킥오프 시작하겠습니다. 오늘 목표는 개발 범위를 확정하는 거예요.", speaker: "화자 1" },
  { start: 6.4, end: 15.2, text: "범위부터 좁히는 게 맞다고 봅니다. 지금 올라온 요구사항을 다 넣으면 3분기 안에는 절대 안 끝나요.", speaker: "화자 2" },
  { start: 15.2, end: 24.8, text: "동의합니다. 수강 신청이랑 진도 관리, 이 두 개만 확실하게 하고 나머지는 뒤로 미뤘으면 좋겠어요.", speaker: "화자 3" },
  { start: 24.8, end: 35.1, text: "결제 연동은요? 그건 오픈할 때 꼭 필요한 거 아닌가요?", speaker: "화자 4" },
  { start: 35.1, end: 48.6, text: "PG사 심사가 보통 3주 걸립니다. 지금 신청해도 9월 중순인데, 그 뒤에 붙이고 테스트하면 일정이 무조건 밀려요.", speaker: "화자 2" },
  { start: 48.6, end: 58.0, text: "그럼 결제는 4분기로 넘기고, 3분기는 무료 과정 위주로 오픈하는 걸로 하죠.", speaker: "화자 1" },
  { start: 58.0, end: 69.3, text: "좋습니다. 대신 QA 기간은 최소 2주 확보해주셔야 해요. 지난번처럼 오픈 직전에 몰리면 곤란합니다.", speaker: "화자 4" },
  { start: 69.3, end: 80.5, text: "9월 30일 오픈이면 9월 15일에는 기능 동결해야 한다는 얘기네요. 그렇게 잡겠습니다.", speaker: "화자 1" },
  { start: 80.5, end: 91.2, text: "디자인 시안은 언제 볼 수 있을까요? 그거 나와야 프론트 작업을 시작할 수 있어서요.", speaker: "화자 3" },
  { start: 91.2, end: 99.8, text: "다음 주 화요일까지 Figma로 공유드릴게요. 피드백은 코멘트로 남겨주시면 됩니다.", speaker: "화자 2" },
];

const TRANSCRIPT = SEGMENTS.map(
  (s) => `[${s.speaker}] [${fmt(s.start)} - ${fmt(s.end)}] ${s.text}`
).join("\n");

function fmt(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

const RESULT = {
  meeting_id: "20260715_1430_demo",
  transcript: TRANSCRIPT,
  segments: SEGMENTS,
  speaker_guess: { "화자 1": "박기획", "화자 2": "김개발", "화자 3": "이교육", "화자 4": "최운영" },
  notes: NOTES,
  notion_url: "",
  notion_error: "데모 모드에서는 Notion에 저장하지 않습니다.",
  department: "교육사업본부",
  registrant: "박기획",
  upload_date: "2026-07-15",
  meeting_date: "2026-07-15",
  creator_email: "demo@example.com",
  creator_name: "데모 사용자",
  email_sent: false,
  email_error: "",
  duration_seconds: 3180,
  requested_emails: [],
};

const MEETINGS = [
  {
    meeting_id: "20260715_1430_demo",
    title: "3분기 신규 교육 플랫폼 킥오프",
    department: "교육사업본부",
    registrant: "박기획",
    creator_email: "demo@example.com",
    meeting_date: "2026-07-15",
    upload_date: "2026-07-15",
    duration_seconds: 3180,
    notion_url: "",
  },
  {
    meeting_id: "20260708_1000_demo",
    title: "주간 개발 스탠드업",
    department: "개발사업본부",
    registrant: "김개발",
    creator_email: "demo@example.com",
    meeting_date: "2026-07-08",
    upload_date: "2026-07-08",
    duration_seconds: 1260,
    notion_url: "",
  },
  {
    meeting_id: "20260702_1600_demo",
    title: "상반기 교육 과정 회고",
    department: "교육사업본부",
    registrant: "이교육",
    creator_email: "demo@example.com",
    meeting_date: "2026-07-02",
    upload_date: "2026-07-02",
    duration_seconds: 4020,
    notion_url: "",
  },
];

const STATS = {
  total_count: 3,
  total_minutes: 74,
  by_registrant: [
    { name: "박기획", count: 1, minutes: 53 },
    { name: "이교육", count: 1, minutes: 67 },
    { name: "김개발", count: 1, minutes: 21 },
  ],
  by_department: [
    { name: "교육사업본부", count: 2, minutes: 120 },
    { name: "개발사업본부", count: 1, minutes: 21 },
  ],
  months: [
    {
      month: "2026-07",
      count: 3,
      minutes: 141,
      by_department: [
        { name: "교육사업본부", count: 2, minutes: 120 },
        { name: "개발사업본부", count: 1, minutes: 21 },
      ],
      by_registrant: [
        { name: "이교육", count: 1, minutes: 67 },
        { name: "박기획", count: 1, minutes: 53 },
        { name: "김개발", count: 1, minutes: 21 },
      ],
    },
  ],
};

const LOGS = [
  { ts: "2026-07-15 14:31:02", kind: "access", user: "demo@example.com", method: "POST", path: "/api/meetings/process", status: 200, ms: 118 },
  { ts: "2026-07-15 14:30:44", kind: "access", user: "demo@example.com", method: "GET", path: "/api/meetings/list", status: 200, ms: 7 },
  { ts: "2026-07-15 14:22:10", kind: "client-error", user: "demo@example.com", message: "회의록 생성 실패: 업로드한 파일 형식을 읽을 수 없습니다.", context: "processMeeting" },
  { ts: "2026-07-15 14:20:03", kind: "error", user: "", method: "GET", path: "/api/auth/me", status: 401, ms: 2 },
];

// 진행 중인 가짜 작업들: job_id → 시작 시각
const jobs = new Map();
// 데모에서는 전사가 약 12초 뒤에 끝난 것처럼 보여준다.
const DEMO_JOB_MS = 12000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function handle(path, method) {
  if (path === "/api/auth/config") {
    // 로그인 화면을 보여주되, 데모에서는 구글 대신 '데모로 둘러보기' 버튼을 쓴다.
    return json({ auth_enabled: true, google_client_id: "" });
  }
  if (path === "/api/auth/me") {
    return json({ auth_enabled: true, email: "demo@example.com", name: "데모 사용자", role: "admin", department: null });
  }
  if (path === "/api/meetings/departments") return json({ departments: DEPARTMENTS });
  if (path === "/api/meetings/list") return json({ meetings: MEETINGS, count: MEETINGS.length });
  if (path.startsWith("/api/meetings/detail/")) {
    const id = path.split("/").pop();
    const found = MEETINGS.find((m) => m.meeting_id === id);
    if (!found) return json({ error: "회의록을 찾을 수 없습니다." }, 404);
    return json({ ...RESULT, ...found, notes: { ...NOTES, title: found.title } });
  }
  if (path === "/api/stats/monthly") return json(STATS);
  if (path.startsWith("/api/logs/recent")) {
    const errorsOnly = /errors_only=true/.test(path);
    return json({ logs: errorsOnly ? LOGS.filter((l) => l.kind !== "access") : LOGS });
  }
  if (path === "/api/log/client") return json({ ok: true });
  if (path === "/api/meetings/process" && method === "POST") {
    const jobId = "demo-" + Math.random().toString(36).slice(2, 10);
    jobs.set(jobId, performance.now());
    return json({ job_id: jobId });
  }
  if (path.startsWith("/api/meetings/status/")) {
    const jobId = path.split("/").pop();
    const started = jobs.get(jobId);
    if (started == null) return json({ error: "작업을 찾을 수 없습니다." }, 404);
    if (performance.now() - started < DEMO_JOB_MS) return json({ status: "processing" });
    jobs.delete(jobId);
    return json({ status: "done", result: RESULT });
  }
  if (path === "/api/meetings/send-email") {
    return json({ email_sent: false, email_error: "데모 모드에서는 메일을 보내지 않습니다." });
  }
  return null;
}

export function installDemoBackend() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = (init.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
    let path = url;
    try {
      path = new URL(url, window.location.origin).pathname + new URL(url, window.location.origin).search;
    } catch { /* 상대경로면 그대로 쓴다 */ }

    if (path.includes("/api/")) {
      const apiPath = path.slice(path.indexOf("/api/"));
      const [clean] = apiPath.split("#");
      const res = handle(clean.split("?")[0] === "/api/logs/recent" ? clean : clean.split("?")[0], method);
      if (res) {
        // 실제 네트워크처럼 약간의 지연을 준다.
        await new Promise((r) => setTimeout(r, 180));
        return res;
      }
    }
    return original(input, init);
  };
}
