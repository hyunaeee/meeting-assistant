import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Square,
  Pause,
  Play,
  Users,
  FileText,
  Mail,
  Database,
  CheckCircle2,
  Settings,
  Plus,
  X,
  ChevronRight,
  FolderOpen,
  Save,
  Send,
  RotateCcw,
  AudioLines,
  ListChecks,
  Sparkles,
  Radio,
  MonitorSpeaker,
  Waves,
  Upload,
  ExternalLink,
  Loader2,
  BarChart3,
  Check,
  AlertCircle,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
// 데모 빌드: 백엔드 없이 둘러보는 모드 (GitHub Pages 배포용)
const DEMO = import.meta.env.VITE_DEMO === "true";

// 구글 로그인 토큰(모든 API 호출에 첨부)
let AUTH_TOKEN = (typeof localStorage !== "undefined" && localStorage.getItem("id_token")) || null;
function authHeaders() {
  return AUTH_TOKEN ? { Authorization: "Bearer " + AUTH_TOKEN } : {};
}
function setAuthToken(t) {
  AUTH_TOKEN = t || null;
  if (typeof localStorage !== "undefined") {
    if (t) localStorage.setItem("id_token", t);
    else localStorage.removeItem("id_token");
  }
}

// 브라우저에서 발생한 에러를 서버 로그로 보냄 (관리자가 수집·열람)
function reportClientError(message, context) {
  try {
    fetch(API_BASE_URL + "/api/log/client", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ level: "error", message: String(message).slice(0, 2000), context: String(context || "").slice(0, 500) }),
    }).catch(() => {});
  } catch { /* 로깅 실패는 무시 */ }
}
const DEFAULT_NOTION_LOCATION = "LIKE Notion AI 회의록";
const DEFAULT_NOTION_DESCRIPTION = "기본 회의록 페이지";

// ── 진행 중인 회의록 작업(백그라운드 잡) 저장 ──────────────────────────────
// 브라우저를 새로고침하거나 다른 회의를 만드는 동안에도 진행 상황이 유지되도록
// localStorage 에 저장한다. (서버는 job_id 로 계속 처리 중)
const JOBS_KEY = "active_jobs";
function loadActiveJobs() {
  try {
    const jobs = JSON.parse(localStorage.getItem(JOBS_KEY) || "[]");
    if (!Array.isArray(jobs)) return [];
    // 하루 지난 완료/오류 기록은 정리
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return jobs.filter((j) => j && (j.status === "processing" || (j.startedAt || 0) > cutoff));
  } catch {
    return [];
  }
}
function saveActiveJobs(jobs) {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify((jobs || []).slice(0, 12)));
  } catch { /* 저장 실패는 무시 */ }
}
const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));
const NEW_LINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

const sampleTranscript = [
  {
    speaker: "화자 1",
    text: "회의가 종료되면 자동으로 전사, 요약, Notion 저장까지 진행됩니다.",
  },
  {
    speaker: "화자 2",
    text: "이메일을 입력한 경우에는 Notion 링크와 요약본이 함께 전달됩니다.",
  },
];

function isListSeparator(character) {
  return character === "," || character === ";" || character === NEW_LINE || character === CARRIAGE_RETURN;
}

export function parseListInput(value) {
  const results = [];
  let current = "";
  for (const character of value) {
    if (isListSeparator(character)) {
      const trimmed = current.trim();
      if (trimmed) results.push(trimmed);
      current = "";
    } else {
      current += character;
    }
  }
  const last = current.trim();
  if (last) results.push(last);
  return results;
}

export function parseEmailInput(value) {
  return parseListInput(value);
}

export function parseParticipantInput(value) {
  return parseListInput(value);
}

function formatDuration(totalSeconds) {
  const secondsNumber = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(secondsNumber / 3600);
  const minutes = Math.floor((secondsNumber % 3600) / 60);
  const seconds = secondsNumber % 60;
  if (hours > 0) {
    return hours + "시간 " + minutes + "분 " + seconds + "초";
  }
  if (minutes > 0) {
    return minutes + "분 " + seconds + "초";
  }
  return seconds + "초";
}

function getFileDuration(file) {
  return new Promise((resolve) => {
    if (!file || typeof URL === "undefined") {
      resolve(0);
      return;
    }
    const element = document.createElement(file.type && file.type.startsWith("video") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      cleanup();
      resolve(duration);
    };
    element.onerror = () => {
      cleanup();
      resolve(0);
    };
    element.src = url;
  });
}

function runParsingTests() {
  const participantTests = [
    { input: "김대표", expected: ["김대표"] },
    { input: "김대표, 박팀장; 이개발자", expected: ["김대표", "박팀장", "이개발자"] },
    { input: "김대표" + NEW_LINE + "박팀장", expected: ["김대표", "박팀장"] },
    { input: "김대표,,;박팀장", expected: ["김대표", "박팀장"] },
  ];
  const emailTests = [
    { input: "a@example.com", expected: ["a@example.com"] },
    { input: "a@example.com,b@example.com", expected: ["a@example.com", "b@example.com"] },
    { input: "a@example.com; b@example.com" + CARRIAGE_RETURN + NEW_LINE + "c@example.com", expected: ["a@example.com", "b@example.com", "c@example.com"] },
    { input: ",,; ;", expected: [] },
  ];
  [...participantTests, ...emailTests].forEach((test, index) => {
    const actual = parseListInput(test.input);
    console.assert(JSON.stringify(actual) === JSON.stringify(test.expected), "parseListInput test " + (index + 1) + " failed", { actual, expected: test.expected });
  });
}
if (typeof console !== "undefined") runParsingTests();

export default function App() {
  const [step, setStep] = useState("setup");
  const [recordingState, setRecordingState] = useState("idle");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [participants, setParticipants] = useState([]);
  const [emailInput, setEmailInput] = useState("");
  const [emails, setEmails] = useState([]);
  const [selectedSource, setSelectedSource] = useState("mic");
  const [selectedFile, setSelectedFile] = useState(null);
  const [recordedFile, setRecordedFile] = useState(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [registrant, setRegistrant] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [diarizeEnabled, setDiarizeEnabled] = useState(true);
  const [summaryLang, setSummaryLang] = useState("ko");
  const [transcribeLang, setTranscribeLang] = useState("ko");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [etaSec, setEtaSec] = useState(0);
  // 진행 중/완료된 회의록 작업 목록(우측 하단 패널 + 새로고침 후 재연결용)
  const [activeJobs, setActiveJobs] = useState(() => loadActiveJobs());
  const [, setNowTick] = useState(0);
  const ownedJobsRef = useRef(new Set());      // 이번 세션에서 폴링 중인 job_id
  const foregroundJobIdRef = useRef(null);     // 지금 화면(결과 탭)에 표시 중인 job_id
  const fgTimersRef = useRef({ elapsed: null, progress: null });
  const [statsOpen, setStatsOpen] = useState(false);
  const [authCfg, setAuthCfg] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [gisReady, setGisReady] = useState(false);

  // 전역 브라우저 에러를 서버 로그로 수집
  useEffect(() => {
    const onError = (e) => reportClientError(e.message || "window error", (e.filename || "") + ":" + (e.lineno || ""));
    const onRejection = (e) => reportClientError("unhandledrejection: " + (e.reason?.message || String(e.reason)), "");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // 로그인 설정 로드 + (필요 시) 구글 로그인 초기화
  useEffect(() => {
    fetch(API_BASE_URL + "/api/auth/config")
      .then((r) => r.json())
      .then((cfg) => {
        setAuthCfg(cfg);
        if (!cfg.auth_enabled) { setAuthChecked(true); return; }
        if (AUTH_TOKEN) {
          fetch(API_BASE_URL + "/api/auth/me", { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((me) => { if (me.email) setCurrentUser(me); else setAuthToken(null); })
            .catch(() => setAuthToken(null))
            .finally(() => setAuthChecked(true));
        } else {
          setAuthChecked(true);
        }
        if (cfg.google_client_id) loadGoogleSignIn(cfg.google_client_id);
      })
      .catch(() => { setAuthCfg({ auth_enabled: false }); setAuthChecked(true); });
  }, []);

  const loadGoogleSignIn = (clientId) => {
    const init = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => {
          setAuthToken(resp.credential);
          fetch(API_BASE_URL + "/api/auth/me", { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((me) => { if (me.email) { setCurrentUser(me); setError(""); } })
            .catch(() => { setAuthToken(null); setError("허용되지 않은 계정이거나 로그인에 실패했습니다."); reportClientError("로그인 실패 (auth/me 거부)", "login"); });
        },
      });
      setGisReady(true);
    };
    if (window.google?.accounts?.id) { init(); return; }
    if (document.getElementById("gsi-script")) return;
    const s = document.createElement("script");
    s.id = "gsi-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  };

  // 로그인 화면이 보일 때 구글 버튼 렌더
  useEffect(() => {
    if (gisReady && authCfg?.auth_enabled && authChecked && !currentUser) {
      const el = document.getElementById("gsi-button");
      if (el && !el.hasChildNodes()) {
        window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", locale: "ko", width: 280 });
      }
    }
  }, [gisReady, authCfg, authChecked, currentUser]);

  const logout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
  };
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingAudioContextRef = useRef(null);
  const capturedInputStreamsRef = useRef([]);
  const captureMixerAudioContextRef = useRef(null);
  const testerStreamRef = useRef(null);
  const testerAudioContextRef = useRef(null);
  const testerAnimationRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(null);
  const [audioTestState, setAudioTestState] = useState("idle");
  const [audioTestMessage, setAudioTestMessage] = useState("녹음 전 오디오 테스트를 먼저 실행해주세요.");
  const [audioLevel, setAudioLevel] = useState(0);
  const [processingLogs, setProcessingLogs] = useState([]);
  const [meetingDurationSeconds, setMeetingDurationSeconds] = useState(0);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [manualEmailStatus, setManualEmailStatus] = useState("");

  // 부서 목록을 불러온다.
  useEffect(() => {
    fetch(API_BASE_URL + "/api/meetings/departments", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDepartments(Array.isArray(d.departments) ? d.departments : []))
      .catch(() => setDepartments([]));
  }, []);

  const status = useMemo(() => {
    if (isProcessing) return "회의록 생성 중";
    if (recordingState === "recording") return "녹음 중";
    if (recordingState === "paused") return "일시정지";
    if (recordingState === "finished") return "회의록 생성 완료";
    return "회의 준비";
  }, [recordingState, isProcessing]);

  const hasMeetingTitle = meetingTitle.trim().length > 0;
  const displayTitle = meetingTitle.trim() || "제목 없는 회의";
  const displayParticipants = participants.length ? participants.join(", ") : "참가자 미지정";
  const displayDuration = formatDuration(meetingDurationSeconds || result?.duration_seconds || 0);
  const notes = result?.notes;

  const addParticipant = () => {
    const next = parseParticipantInput(participantInput);
    if (!next.length) return;
    setParticipants((prev) => Array.from(new Set([...prev, ...next])));
    setParticipantInput("");
  };

  const addEmail = () => {
    const next = parseEmailInput(emailInput);
    if (!next.length) return;
    setEmails((prev) => Array.from(new Set([...prev, ...next])));
    setEmailInput("");
  };

  const removeParticipant = (name) => setParticipants((prev) => prev.filter((item) => item !== name));
  const removeEmail = (email) => setEmails((prev) => prev.filter((item) => item !== email));

  const stopTester = () => {
    if (testerAnimationRef.current) {
      cancelAnimationFrame(testerAnimationRef.current);
      testerAnimationRef.current = null;
    }
    if (testerAudioContextRef.current) {
      testerAudioContextRef.current.close().catch(() => {});
      testerAudioContextRef.current = null;
    }
    if (testerStreamRef.current) {
      testerStreamRef.current.getTracks().forEach((track) => track.stop());
      testerStreamRef.current = null;
    }
    closeCaptureMixer();
    stopCapturedInputStreams();
    setAudioLevel(0);
  };

  const resetAudioTester = (message) => {
    stopTester();
    setAudioTestState("idle");
    setAudioTestMessage(message || "녹음 전 오디오 테스트를 먼저 실행해주세요.");
  };

  const stopCapturedInputStreams = () => {
    capturedInputStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    capturedInputStreamsRef.current = [];
  };

  const closeCaptureMixer = () => {
    if (captureMixerAudioContextRef.current) {
      captureMixerAudioContextRef.current.close().catch(() => {});
      captureMixerAudioContextRef.current = null;
    }
  };

  const mixAudioStreams = async (streams) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      const tracks = streams.flatMap((stream) => stream.getAudioTracks());
      return new MediaStream(tracks);
    }

    const audioContext = new AudioContextClass();
    const destination = audioContext.createMediaStreamDestination();
    streams.forEach((stream) => {
      if (stream.getAudioTracks().length > 0) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
      }
    });
    captureMixerAudioContextRef.current = audioContext;
    return destination.stream;
  };

  const requestAudioStream = async () => {
    closeCaptureMixer();
    stopCapturedInputStreams();

    if (selectedSource === "system") {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("이 브라우저는 시스템/탭 오디오 캡처를 지원하지 않습니다. 오프라인 회의 모드 또는 파일 업로드를 사용해주세요.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("이 브라우저는 마이크 녹음을 지원하지 않습니다. 오디오 파일을 업로드해주세요.");
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (displayStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error("오디오 공유가 선택되지 않았습니다. 공유 창에서 탭/화면 오디오 공유 옵션을 켜주세요.");
      }

      let micStream = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_err) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error("온라인 회의에서는 상대방 소리와 내 마이크를 함께 녹음해야 합니다. 마이크 권한을 허용해주세요.");
      }

      capturedInputStreamsRef.current = [displayStream, micStream];
      return mixAudioStreams([displayStream, micStream]);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 마이크 녹음을 지원하지 않습니다. 오디오 파일을 업로드해주세요.");
    }
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    capturedInputStreamsRef.current = [micStream];
    return micStream;
  };

  const startAudioTest = async () => {
    setError("");
    stopTester();
    setAudioTestState("checking");
    setAudioTestMessage(selectedSource === "system" ? "공유 창에서 회의 오디오를 선택한 뒤 마이크 권한도 허용해주세요. 상대방 소리와 내 마이크를 함께 확인 중입니다." : "마이크 권한을 허용한 뒤 말소리가 들어오는지 확인 중입니다.");

    try {
      const stream = await requestAudioStream();
      testerStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("이 브라우저는 오디오 레벨 테스트를 지원하지 않습니다. Chrome 또는 Edge에서 다시 시도해주세요.");
      }

      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      testerAudioContextRef.current = audioContext;

      const data = new Uint8Array(analyser.fftSize);
      let detected = false;
      let silentFrames = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(100, Math.round(rms * 420));
        setAudioLevel(level);

        if (level >= 4) {
          detected = true;
          silentFrames = 0;
          setAudioTestState("ready");
          setAudioTestMessage(selectedSource === "system" ? "온라인 회의 소리와 마이크 입력이 함께 인식되었습니다. 회의를 시작할 수 있습니다." : "마이크 입력이 정상 인식되었습니다. 회의를 시작할 수 있습니다.");
        } else if (!detected) {
          silentFrames += 1;
          if (silentFrames > 120) {
            setAudioTestState("no-signal");
            setAudioTestMessage(selectedSource === "system" ? "오디오 장치는 연결됐지만 소리가 감지되지 않습니다. 회의/영상 소리를 재생하거나 오디오 공유 옵션을 확인해주세요." : "마이크는 연결됐지만 소리가 감지되지 않습니다. 마이크 입력 장치와 권한을 확인하고 말해보세요.");
          }
        }

        testerAnimationRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (err) {
      stopTester();
      setAudioTestState("error");
      setAudioTestMessage(err.message || "오디오 장치를 확인하지 못했습니다. 브라우저 권한과 장치 연결을 확인해주세요.");
    }
  };

  const stopActiveStream = () => {
    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (testerAudioContextRef.current) {
      testerAudioContextRef.current.close().catch(() => {});
      testerAudioContextRef.current = null;
    }
    closeCaptureMixer();
    stopCapturedInputStreams();
  };

  const getSupportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const startRecording = async () => {
    setError("");
    setResult(null);
    setRecordedFile(null);
    setMeetingDurationSeconds(0);
    recordingStartedAtRef.current = null;
    setManualEmailStatus("");

    if (typeof MediaRecorder === "undefined") {
      setError("이 브라우저는 녹음을 지원하지 않습니다. Chrome 또는 Edge에서 다시 시도하거나 오디오 파일을 업로드해주세요.");
      return;
    }

    if (audioTestState !== "ready") {
      setError("오디오 테스트가 완료되어야 회의를 시작할 수 있습니다. 먼저 '오디오 테스트'를 눌러 소리 입력을 확인해주세요.");
      return;
    }

    try {
      const stream = testerStreamRef.current;
      const hasLiveAudioTrack = stream && stream.getAudioTracks().some((track) => track.readyState === "live");

      if (!hasLiveAudioTrack) {
        setAudioTestState("idle");
        setAudioTestMessage("테스트된 오디오 연결이 끊어졌습니다. 오디오 테스트를 다시 실행해주세요.");
        setError("테스트된 오디오 연결이 없습니다. 회의 시작 전에 오디오 테스트를 다시 실행해주세요.");
        return;
      }

      testerStreamRef.current = null;
      if (testerAnimationRef.current) {
        cancelAnimationFrame(testerAnimationRef.current);
        testerAnimationRef.current = null;
      }

      const recordingStream = stream;
      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
      recordedChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("녹음 중 오류가 발생했습니다. 오디오 파일 업로드 방식으로 다시 시도해주세요.");
        stopActiveStream();
      };

      recorder.onstop = async () => {
        stopActiveStream();
        const chunks = recordedChunksRef.current;
        if (!chunks.length) {
          setError("녹음된 오디오가 없습니다. 브라우저 권한과 오디오 입력을 확인해주세요.");
          setRecordingState("finished");
          setStep("result");
          return;
        }
        const type = chunks[0]?.type || mimeType || "audio/webm";
        const endedAt = new Date();
        const startedAt = recordingStartedAtRef.current;
        const durationSeconds = startedAt ? Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : 1;
        setMeetingDurationSeconds(durationSeconds);
        const blob = new Blob(chunks, { type });
        const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], "browser-recording." + extension, { type });
        setRecordedFile(file);
        setRecordingState("finished");
        setStep("result");
        await processMeeting(file, durationSeconds);
      };

      const startedAt = new Date();
      recordingStartedAtRef.current = startedAt;
      setRecordingStartedAt(startedAt);
      recorder.start(1000);
      setRecordingState("recording");
      setStep("recording");
    } catch (err) {
      stopActiveStream();
      setError(err.message || "녹음 권한을 가져오지 못했습니다. 브라우저 권한을 확인해주세요.");
      setRecordingState("idle");
      setStep("setup");
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      setRecordingState("paused");
    }
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      setRecordingState("recording");
    }
  };

  const finishRecording = async () => {
    setStep("result");
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch (_err) {
        // 일부 브라우저는 requestData를 지원하지 않을 수 있습니다.
      }
      recorder.stop();
      return;
    }

    if (selectedFile) {
      setRecordingState("finished");
      await processMeeting(selectedFile);
      return;
    }

    if (recordedFile) {
      setRecordingState("finished");
      await processMeeting(recordedFile);
      return;
    }

    setRecordingState("finished");
    setError("녹음된 오디오나 업로드된 파일이 없습니다. 회의 시작 후 녹음 권한을 허용하거나 오디오 파일을 선택해주세요.");
  };

  const processUploadedFile = async () => {
    if (!selectedFile) {
      setError("처리할 오디오 파일을 먼저 선택해주세요.");
      return;
    }
    setError("");
    setRecordedFile(null);
    setRecordingState("finished");
    setStep("result");
    const duration = await getFileDuration(selectedFile);
    await processMeeting(selectedFile, duration);
  };

  // ── 백그라운드 잡 관리 ──────────────────────────────────────────────
  // activeJobs 를 localStorage 에 저장 (새로고침 후 재연결용)
  useEffect(() => { saveActiveJobs(activeJobs); }, [activeJobs]);

  // 진행 중 잡이 있으면 1초마다 경과 시간 갱신
  useEffect(() => {
    if (!activeJobs.some((j) => j.status === "processing")) return;
    const t = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [activeJobs]);

  const upsertJob = (id, patch) => {
    setActiveJobs((prev) => {
      const i = prev.findIndex((j) => j.id === id);
      if (i === -1) return [{ id, ...patch }, ...prev].slice(0, 12);
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };
  const removeJob = (id) => setActiveJobs((prev) => prev.filter((j) => j.id !== id));

  // 한 잡을 완료/오류/중단까지 견고하게 폴링한다.
  // 일시적 네트워크·프록시 오류(504 HTML 응답 등)로는 절대 중단하지 않는다. ← 튕김 버그 수정
  const pollJob = async (jobId, { onDone, onError, onStalled } = {}) => {
    const startedAt = Date.now();
    const HARD_DEADLINE = 3 * 60 * 60 * 1000; // 3시간
    const MAX_FAILS = 40;                      // 연속 실패 40회(~2분)면 백그라운드 처리로 간주
    let fails = 0;
    while (true) {
      await sleep(3000);
      if (Date.now() - startedAt > HARD_DEADLINE) { onStalled && onStalled("deadline"); return; }
      let statusData = null;
      let ok = false;
      try {
        const r = await fetch(API_BASE_URL + "/api/meetings/status/" + jobId, { headers: authHeaders() });
        const text = await r.text();
        try { statusData = JSON.parse(text); } catch { statusData = null; }
        ok = r.ok && !!statusData;
      } catch { ok = false; }
      if (!ok) {
        fails += 1;
        if (fails >= MAX_FAILS) { onStalled && onStalled("network"); return; }
        continue; // 일시적 실패 → 무시하고 계속 폴링
      }
      fails = 0;
      if (statusData.status === "done") { onDone && onDone(statusData.result); return; }
      if (statusData.status === "error") { onError && onError(statusData.error || "회의록 생성 실패"); return; }
      // status === "processing" → 계속
    }
  };

  // 새로고침 등으로 이번 세션의 폴링이 끊긴 이전 잡을 백그라운드에서 다시 연결
  useEffect(() => {
    activeJobs.forEach((j) => {
      if (j.status !== "processing" || ownedJobsRef.current.has(j.id)) return;
      ownedJobsRef.current.add(j.id);
      pollJob(j.id, {
        onDone: (data) => upsertJob(j.id, { status: "done", result: data, notionUrl: data?.notion_url, notionError: data?.notion_error }),
        onError: (msg) => upsertJob(j.id, { status: "error", error: msg }),
        onStalled: () => upsertJob(j.id, { status: "stalled" }),
      }).finally(() => ownedJobsRef.current.delete(j.id));
    });
    // 마운트 시 1회만 (복원된 잡 재연결)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 완료된 백그라운드 잡을 화면(결과 탭)으로 불러오기
  const viewJob = (job) => {
    if (!job?.result) return;
    foregroundJobIdRef.current = job.id;
    setResult(job.result);
    setError("");
    setIsProcessing(false);
    setMeetingDurationSeconds(0);
    setProcessingLogs([
      { label: "회의록 생성 완료", status: "done" },
      ...(job.result.notion_url ? [{ label: "Notion 자동 저장 완료", status: "done" }] : []),
      ...(job.result.notion_error ? [{ label: "Notion 저장 확인 필요", status: "error" }] : []),
    ]);
    setStep("result");
  };

  // 진행 중인 포그라운드 잡을 백그라운드로 돌리고 새 회의를 준비
  const backgroundCurrent = () => {
    foregroundJobIdRef.current = null;
    window.clearInterval(fgTimersRef.current.elapsed);
    window.clearInterval(fgTimersRef.current.progress);
    setIsProcessing(false);
    setResult(null);
    setProcessingLogs([]);
    setError("");
    // 새 회의를 위한 최소 초기화 (부서·등록자·언어 설정은 유지)
    setStep("setup");
    setRecordingState("idle");
    setSelectedFile(null);
    setRecordedFile(null);
    setRecordingStartedAt(null);
    recordingStartedAtRef.current = null;
    setMeetingTitle("");
    setParticipants([]);
    setMeetingDurationSeconds(0);
    resetAudioTester();
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
  };

  const processMeeting = async (file, explicitDurationSeconds) => {
    if (!selectedDepartment) {
      setError("부서를 먼저 선택해주세요.");
      return;
    }
    if (!registrant.trim()) {
      setError("등록자를 입력해주세요.");
      return;
    }
    let durationForRequest = explicitDurationSeconds || meetingDurationSeconds;
    if (!durationForRequest && recordingStartedAtRef.current) {
      durationForRequest = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current.getTime()) / 1000));
    }
    if (!durationForRequest && file) {
      durationForRequest = await getFileDuration(file);
    }
    durationForRequest = Math.max(1, Math.round(Number(durationForRequest) || 1));
    setMeetingDurationSeconds(durationForRequest);
    setIsProcessing(true);
    setError("");
    setResult(null);

    // 예상 처리 시간(대략): 화자분리 켜면 더 오래. (실제는 하드웨어/길이에 따라 다름)
    const etaSeconds = Math.max(20, Math.round(durationForRequest * (diarizeEnabled ? 0.15 : 0.12)));
    setEtaSec(etaSeconds);
    setElapsedSec(0);
    const elapsedTimer = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);

    const baseLogs = [
      { label: formatDuration(durationForRequest) + "짜리 회의 요약을 시작합니다", status: "done" },
      { label: "녹음 파일 준비", status: "done" },
      { label: "서버로 녹음 파일 전송 중", status: "active" },
    ];
    setProcessingLogs(baseLogs);

    const timedMessages = [
      "음성 파일을 분석 가능한 형식으로 변환하고 있어요",
      "회의 음성을 텍스트로 받아쓰고 있어요 (길수록 오래 걸려요)",
      "목소리를 구분해 화자를 나누고 있어요",
      "대화 내용으로 화자와 참가자를 추측하고 있어요",
      "AI가 회의 요약을 만들고 있어요",
      "Notion에 회의록을 저장하고 있어요",
      emails.length ? "이메일 전달을 준비하고 있어요" : "마무리하고 있어요",
    ];
    let messageIndex = 0;
    const progressTimer = window.setInterval(() => {
      // 마지막 단계에 도달하면 그 항목을 active(스피너) 상태로 유지 → 오래 걸려도 멈춘 것처럼 안 보임
      if (messageIndex >= timedMessages.length) return;
      const message = timedMessages[messageIndex];
      setProcessingLogs((prev) => {
        const withoutActive = prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log);
        if (withoutActive.some((log) => log.label === message)) return withoutActive;
        return [...withoutActive, { label: message, status: "active" }];
      });
      messageIndex += 1;
    }, 6500);
    // 백그라운드 전환 시 이 타이머들을 멈출 수 있게 보관
    fgTimersRef.current = { elapsed: elapsedTimer, progress: progressTimer };

    const displayTitle = meetingTitle.trim() || (formatDuration(durationForRequest) + " 회의");
    let jobId = null;
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("title", meetingTitle.trim());
      form.append("participants", JSON.stringify(participants));
      form.append("emails", JSON.stringify(emails));
      form.append("duration_seconds", String(durationForRequest || 0));
      form.append("department", selectedDepartment);
      form.append("registrant", registrant.trim());
      form.append("meeting_date", meetingDate || "");
      form.append("diarize", diarizeEnabled ? "true" : "false");
      form.append("summary_lang", summaryLang);
      form.append("transcribe_lang", transcribeLang);

      // 1) 업로드 → 즉시 job_id 수신 (요청이 짧아 프록시 60초 타임아웃 회피)
      const startResp = await fetch(API_BASE_URL + "/api/meetings/process", {
        method: "POST",
        body: form,
        headers: authHeaders(),
      });
      const startData = await startResp.json();
      if (!startResp.ok || !startData.job_id) {
        throw new Error(startData.detail || startData.error || "회의록 생성 요청 실패");
      }

      // 이 잡을 목록/새로고침 재연결용으로 등록하고 화면 소유권을 준다.
      jobId = startData.job_id;
      ownedJobsRef.current.add(jobId);
      foregroundJobIdRef.current = jobId;
      upsertJob(jobId, {
        title: displayTitle,
        department: selectedDepartment,
        meetingId: startData.meeting_id || "",
        startedAt: Date.now(),
        etaSeconds,
        status: "processing",
      });

      // 2) 완료될 때까지 견고하게 폴링 (일시 오류로는 중단하지 않음)
      await pollJob(jobId, {
        onDone: (data) => {
          upsertJob(jobId, { status: "done", result: data, notionUrl: data?.notion_url, notionError: data?.notion_error });
          if (foregroundJobIdRef.current !== jobId) return; // 백그라운드로 돌린 경우 화면 갱신 안 함
          setResult(data);
          setManualEmailStatus("");
          setProcessingLogs((prev) => {
            const doneLogs = prev.map((log) => ({ ...log, status: "done" }));
            const finalLogs = [...doneLogs, { label: "회의록 생성 완료", status: "done" }];
            if (data.notion_url) finalLogs.push({ label: "Notion 자동 저장 완료", status: "done" });
            if (data.notion_error) finalLogs.push({ label: "Notion 저장 확인 필요", status: "error" });
            finalLogs.push({ label: "필요하면 아래에서 이메일을 보낼 수 있습니다", status: "done" });
            return finalLogs;
          });
        },
        onError: (msg) => {
          upsertJob(jobId, { status: "error", error: msg });
          reportClientError("회의록 생성 실패: " + msg, "processMeeting");
          if (foregroundJobIdRef.current !== jobId) return;
          setError(msg || "회의록 생성 중 오류가 발생했습니다.");
          setProcessingLogs((prev) => [...prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log), { label: "회의록 생성 중 오류 발생", status: "error" }]);
        },
        onStalled: () => {
          // 서버는 계속 처리 중일 수 있음 → 목록에 남겨두고, 화면은 안내만
          upsertJob(jobId, { status: "stalled" });
          if (foregroundJobIdRef.current !== jobId) return;
          setError("서버는 계속 처리 중일 수 있어요. 잠시 후 오른쪽 아래 '처리 중인 회의' 목록이나 Notion에서 확인해주세요.");
          setProcessingLogs((prev) => [...prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log), { label: "백그라운드에서 계속 처리 중", status: "active" }]);
        },
      });
    } catch (err) {
      const msg = err.message || "회의록 생성 중 오류가 발생했습니다.";
      if (jobId) upsertJob(jobId, { status: "error", error: msg });
      reportClientError("회의록 생성 실패: " + (err.message || err.name || "unknown"), "processMeeting");
      if (foregroundJobIdRef.current === jobId || jobId === null) {
        setError(msg);
        setProcessingLogs((prev) => [...prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log), { label: "회의록 생성 중 오류 발생", status: "error" }]);
      }
    } finally {
      window.clearInterval(progressTimer);
      window.clearInterval(elapsedTimer);
      if (jobId) ownedJobsRef.current.delete(jobId);
      if (foregroundJobIdRef.current === jobId) {
        setIsProcessing(false);
        // 완료 화면(결과)은 유지, 소유권만 해제
      }
    }
  };

  const sendEmailAfterMeeting = async (targetEmails = []) => {
    if (!result?.notes) {
      setManualEmailStatus("회의록 생성 후 이메일을 보낼 수 있습니다.");
      return;
    }

    const mergedEmails = Array.from(new Set([...(emails || []), ...(targetEmails || [])].map((item) => String(item).trim()).filter(Boolean)));

    if (!mergedEmails.length) {
      setManualEmailStatus("전달할 이메일을 먼저 추가해주세요.");
      return;
    }

    setEmails(mergedEmails);
    setIsSendingEmail(true);
    setManualEmailStatus("이메일을 보내는 중입니다...");
    try {
      const response = await fetch(API_BASE_URL + "/api/meetings/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          emails: mergedEmails,
          notes: result.notes,
          notion_url: result.notion_url || "",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.sent) {
        throw new Error(data.error || "이메일 전달 실패");
      }
      setResult((prev) => prev ? { ...prev, email_sent: true, email_error: "", emailed_recipients: mergedEmails } : prev);
      setManualEmailStatus("이메일 전달이 완료되었습니다. (" + mergedEmails.length + "명)");
    } catch (err) {
      setResult((prev) => prev ? { ...prev, email_sent: false, email_error: err.message || "이메일 전달 실패" } : prev);
      setManualEmailStatus(err.message || "이메일 전달 중 오류가 발생했습니다.");
    } finally {
      setIsSendingEmail(false);
    }
  };


  const resetMeeting = () => {
    setStep("setup");
    setRecordingState("idle");
    setMeetingTitle("");
    setParticipantInput("");
    setParticipants([]);
    setEmailInput("");
    setEmails([]);
    setSelectedFile(null);
    setRecordedFile(null);
    setRecordingStartedAt(null);
    recordingStartedAtRef.current = null;
    setMeetingDurationSeconds(0);
    setIsSendingEmail(false);
    setManualEmailStatus("");
    stopActiveStream();
    resetAudioTester();
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setResult(null);
    setProcessingLogs([]);
    setError("");
  };

  // 인증 설정/세션 확인이 끝나기 전에는 메인 화면을 그리지 않는다
  // (메인 화면이 먼저 번쩍 보였다가 로그인 화면으로 바뀌는 것 방지)
  if (!authCfg || !authChecked) {
    return (
      <main className="bg">
        <div className="blur-a" />
        <div className="blur-b" />
        <div className="blur-c" />
        <div className="login-gate">
          <div className="login-card">
            <div className="logo-icon" style={{ width: 56, height: 56, margin: "0 auto 18px" }}><Mic size={26} /></div>
            <h1 className="h2" style={{ fontSize: 24 }}>LIKE meeting assistant</h1>
            <p className="help" style={{ marginTop: 10 }}><Loader2 size={14} className="process-spin" /> 불러오는 중…</p>
          </div>
        </div>
      </main>
    );
  }

  // 로그인 필수인데 아직 로그인 안 했으면 로그인 화면
  if (authCfg?.auth_enabled && authChecked && !currentUser) {
    return (
      <main className="bg">
        <div className="blur-a" />
        <div className="blur-b" />
        <div className="blur-c" />
        <div className="login-gate">
          <div className="login-card">
            <div className="logo-icon" style={{ width: 56, height: 56, margin: "0 auto 18px" }}><Mic size={26} /></div>
            <h1 className="h2" style={{ fontSize: 24 }}>LIKE meeting assistant</h1>
            <p className="help" style={{ marginBottom: 22 }}>회사 구글 계정으로 로그인하세요. 본인이 만든 회의록만 볼 수 있습니다.</p>
            {DEMO ? (
              <>
                <button className="btn-primary" type="button" style={{ width: "100%" }}
                  onClick={() => setCurrentUser({ email: "demo@example.com", name: "데모 사용자", role: "admin", department: null })}>
                  데모로 둘러보기
                </button>
                <p className="help" style={{ marginTop: 14 }}>
                  실제 배포판은 회사 구글 계정 로그인이 필요합니다. 이 데모는 가짜 데이터로 동작하며 서버에 아무것도 저장되지 않습니다.
                </p>
              </>
            ) : (
              <div id="gsi-button" style={{ display: "flex", justifyContent: "center" }} />
            )}
            {!DEMO && !gisReady && <p className="help" style={{ marginTop: 14 }}><Loader2 size={14} className="process-spin" /> 로그인 버튼 불러오는 중…</p>}
            {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg">
      <div className="blur-a" />
      <div className="blur-b" />
      <div className="blur-c" />

      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon"><Mic size={20} /></div>
            <div>
              <h1 className="logo-title">LIKE meeting assistant {DEMO && <span className="demo-badge">DEMO</span>}</h1>
              <p className="logo-sub">{DEMO ? "데모 · 가짜 데이터로 동작합니다" : status}</p>
            </div>
          </div>
          <div className="header-right">
            {currentUser && <button className="stats-btn" type="button" onClick={() => setListOpen(true)}><FileText size={16} /> 회의록 목록</button>}
            <button className="stats-btn" type="button" onClick={() => setStatsOpen(true)}><BarChart3 size={16} /> 이용 통계</button>
            {currentUser?.role === "admin" && <button className="stats-btn" type="button" onClick={() => setLogsOpen(true)}><AudioLines size={16} /> 로그</button>}
            {currentUser && (
              <span className="user-chip" title={currentUser.email}>
                {currentUser.name}{currentUser.role === "admin" ? " · 관리자" : currentUser.role === "ceo" ? " · 대표" : currentUser.role === "head" ? ` · ${currentUser.department} 본부장` : ""}
                <button className="logout-btn" type="button" onClick={logout}>로그아웃</button>
              </span>
            )}
            <div className="steps">
              <StepPill active={step === "setup"} done={step !== "setup"} label="설정" />
              <ChevronRight size={16} color="#cbd5e1" />
              <StepPill active={step === "recording"} done={step === "result"} label="녹음" />
              <ChevronRight size={16} color="#cbd5e1" />
              <StepPill active={step === "result"} done={false} label="결과" />
            </div>
          </div>
        </div>
      </header>
      {statsOpen && <StatsModal onClose={() => setStatsOpen(false)} />}
      {listOpen && <MeetingsListModal onClose={() => setListOpen(false)} currentUser={currentUser} />}
      {logsOpen && <LogsModal onClose={() => setLogsOpen(false)} />}

      <section className={"container" + (step === "result" ? " container-result" : "")}>
        {step !== "result" && (
        <aside className="stack">
          <motion.div className="card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="card-inner">
              <div className="card-head">
                <div>
                  <div className="badge"><Sparkles size={14} /> Optional setup</div>
                  <h2 className="h2">회의 설정</h2>
                  <p className="help">필요한 항목만 입력하고 바로 시작하세요.</p>
                </div>
                <div className="icon-box"><Settings size={20} /></div>
              </div>

              <div className="field">
                <FieldLabel title="회의 제목" optional />
                <input className="input" value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} placeholder="입력하지 않으면 자동 제목으로 저장" />
              </div>

              <div className="field">
                <FieldLabel title="참가자" optional />
                <div className="input-row">
                  <input
                    className="input"
                    value={participantInput}
                    onChange={(e) => setParticipantInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addParticipant();
                      }
                    }}
                    placeholder="이름 입력 후 Enter 또는 추가"
                  />
                  <button className="add-btn" type="button" onClick={addParticipant}><Plus size={20} /></button>
                </div>
                <TagList items={participants} onRemove={removeParticipant} variant="light" />
              </div>

              <div className="field">
                <FieldLabel title="부서" required />
                <select
                  className="input"
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                >
                  <option value="">부서를 선택하세요</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <FieldLabel title="등록자" required />
                <input
                  className="input"
                  value={registrant}
                  onChange={(e) => setRegistrant(e.target.value)}
                  placeholder="회의록을 등록하는 사람 이름"
                />
              </div>

              <div className="field">
                <FieldLabel title="회의 일자" />
                <input
                  className="input"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
                <p className="help">실제 회의가 열린 날짜입니다. (등록일과 별도로 기록)</p>
              </div>

              <div className="field">
                <FieldLabel title="전사 언어" />
                <select className="input" value={transcribeLang} onChange={(e) => setTranscribeLang(e.target.value)}>
                  <option value="ko">한국어 (기본)</option>
                  <option value="en">English</option>
                  <option value="">자동 감지 (한·영 혼용)</option>
                </select>
                <p className="help">회의에서 말한 언어입니다. 한국어 회의는 그대로 두세요.</p>
              </div>

              <div className="field">
                <FieldLabel title="회의록 언어" />
                <select className="input" value={summaryLang} onChange={(e) => setSummaryLang(e.target.value)}>
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
                <p className="help">요약 회의록을 작성할 언어입니다. (전사본은 말한 언어 그대로 유지)</p>
              </div>

              <div className="field">
                <label className="toggle-row">
                  <input type="checkbox" checked={diarizeEnabled} onChange={(e) => setDiarizeEnabled(e.target.checked)} />
                  <span><b>화자 구분</b> — 목소리별로 화자를 나눠 표시. <span className="toggle-hint">느려짐 · 기본 켜짐</span></span>
                </label>
              </div>

              <div className="field">
                <FieldLabel title="Notion 저장 위치" />
                <div className="notion-box">
                  <div className="notion-icon"><FolderOpen size={20} /></div>
                  <div>
                    <p className="notion-title">{DEFAULT_NOTION_LOCATION}</p>
                    <p className="notion-desc">{DEFAULT_NOTION_DESCRIPTION}</p>
                  </div>
                </div>
                <p className="help">회의록 생성 시 이 위치에 자동 저장됩니다. (부서·등록자·등록일이 함께 기록됩니다)</p>
              </div>

              <div className="field">
                <FieldLabel title="전달 이메일" optional />
                <div className="input-row">
                  <input
                    className="input"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addEmail();
                      }
                    }}
                    placeholder="여러 명에게 동시 전달 가능"
                  />
                  <button className="add-btn" type="button" onClick={addEmail}><Plus size={20} /></button>
                </div>
                <TagList items={emails} onRemove={removeEmail} variant="dark" />
              </div>
            </div>
          </motion.div>

          <motion.div className="card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
            <div className="card-inner">
              <h3 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>저장/전달 설정</h3>
              <div className="summary-row">
                <SummaryItem icon={Database} label="Notion" value={(selectedDepartment ? selectedDepartment + " · " : "") + DEFAULT_NOTION_LOCATION} />
                <SummaryItem icon={Mail} label="Email" value={emails.length ? emails.length + "명에게 전달" : "전달 안 함"} />
                <SummaryItem icon={Users} label="Participants" value={displayParticipants} />
              </div>
            </div>
          </motion.div>
        </aside>
        )}

        <section className="stack">
          {step !== "result" && (
          <motion.div className="hero-card" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }}>
            <div className="hero-inner">
              <div className="hero-top">
                <div>
                  <div className="status-pill"><Radio size={16} /> {status}</div>
                  <h2 className={"hero-title " + (hasMeetingTitle ? "" : "placeholder")}>{displayTitle}</h2>
                  <p className="hero-participants">{displayParticipants}</p>
                </div>
                <div className={"audio-icon " + (recordingState === "recording" ? "live" : "")}><AudioLines size={38} /></div>
              </div>

              <div className="source-grid">
                <SourceButton active={selectedSource === "mic"} icon={Mic} title="오프라인 회의" desc="마이크로 바로 녹음" onClick={() => { setSelectedSource("mic"); resetAudioTester("마이크 입력을 다시 테스트해주세요."); }} />
                <SourceButton active={selectedSource === "system"} icon={MonitorSpeaker} title="온라인 회의" desc="시스템/탭 오디오 녹음" onClick={() => { setSelectedSource("system"); resetAudioTester("온라인 회의 오디오를 다시 테스트해주세요."); }} />
              </div>

              <AudioTester
                selectedSource={selectedSource}
                audioLevel={audioLevel}
                audioTestState={audioTestState}
                audioTestMessage={audioTestMessage}
                onStart={startAudioTest}
                onStop={() => resetAudioTester()}
              />

              <div className="record-panel">
                <div className="record-head">
                  <div>
                    <p className="record-label">Recording status</p>
                    <p className="record-status">{status}</p>
                    {(meetingDurationSeconds > 0 || isProcessing || result) && <p className="record-label">회의 길이: {displayDuration}</p>}
                    {recordingStartedAt && (recordingState === "recording" || recordingState === "paused") && <p className="record-label">시작: {recordingStartedAt.toLocaleTimeString()}</p>}
                  </div>
                  {recordingState === "recording" ? <div className="live"><span className="live-dot" /> LIVE</div> : <Waves size={28} color="#94a3b8" />}
                </div>

                <div className="actions">
                  <input ref={fileRef} className="file-input" type="file" accept="audio/*,video/*" onChange={async (e) => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    setRecordedFile(null);
                    setResult(null);
                    setManualEmailStatus("");
                    setError("");
                    if (file) {
                      const duration = await getFileDuration(file);
                      setMeetingDurationSeconds(duration);
                    } else {
                      setMeetingDurationSeconds(0);
                    }
                  }} />
                  <button className="secondary" type="button" onClick={() => fileRef.current?.click()}><Upload size={18} /> {selectedFile ? selectedFile.name : recordedFile ? recordedFile.name : "오디오 파일 선택"}</button>
                  {recordingState !== "recording" && recordingState !== "paused" && selectedFile && <button className="primary" onClick={processUploadedFile} disabled={isProcessing || !selectedDepartment || !registrant.trim()}><FileText size={18} /> 업로드 파일로 회의록 만들기</button>}
                  {recordingState !== "recording" && recordingState !== "paused" && !selectedFile && <button className="primary" onClick={startRecording} disabled={audioTestState !== "ready" || isProcessing || !selectedDepartment || !registrant.trim()}><Play size={18} /> 회의 시작</button>}
                  {recordingState === "recording" && <button className="secondary" onClick={pauseRecording}><Pause size={18} /> 일시정지</button>}
                  {recordingState === "paused" && <button className="primary" onClick={resumeRecording}><Play size={18} /> 다시 시작</button>}
                  {(recordingState === "recording" || recordingState === "paused") && <button className="danger" onClick={finishRecording} disabled={isProcessing}><Square size={18} /> 종료하고 회의록 만들기</button>}
                  {recordingState === "finished" && <button className="secondary" onClick={resetMeeting}><RotateCcw size={18} /> 새 회의 시작</button>}
                  {recordingState !== "recording" && recordingState !== "paused" && (!selectedDepartment || !registrant.trim()) && (
                    <p className="help" style={{ flexBasis: "100%", margin: 0, color: "var(--accent-strong)", fontWeight: 600 }}>
                      회의록을 시작하려면 <b>회의 설정</b>에서 <b>부서</b>와 <b>등록자</b>를 먼저 입력하세요.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
          )}

          {step === "setup" && <EmptyState />}
          {step === "recording" && <ProgressPanel recordingState={recordingState} />}
          {step === "result" && <ResultPanel result={result} notes={notes} participants={participants} emails={emails} error={error} isProcessing={isProcessing} processingLogs={processingLogs} durationLabel={displayDuration} elapsedSec={elapsedSec} etaSec={etaSec} onSendEmail={sendEmailAfterMeeting} isSendingEmail={isSendingEmail} manualEmailStatus={manualEmailStatus} onReset={resetMeeting} onBackground={backgroundCurrent} />}
        </section>
      </section>

      <BackgroundJobs jobs={activeJobs} foregroundId={foregroundJobIdRef.current} onView={viewJob} onDismiss={removeJob} />
    </main>
  );
}

// 우측 하단에 진행 중/완료된 회의록 작업을 띄운다.
function BackgroundJobs({ jobs, foregroundId, onView, onDismiss }) {
  const visible = (jobs || []).filter((j) => j.status !== "processing" || j.id !== foregroundId);
  if (!visible.length) return null;
  const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="bg-jobs">
      {visible.map((j) => {
        const elapsed = Math.max(0, Math.round((Date.now() - (j.startedAt || Date.now())) / 1000));
        const eta = j.etaSeconds || 0;
        const pct = j.status === "processing" && eta ? Math.min(97, Math.round((elapsed / eta) * 100)) : 100;
        return (
          <div key={j.id} className={"bg-job bg-" + j.status}>
            <div className="bg-job-top">
              <span className="bg-job-icon">
                {j.status === "processing" ? <Loader2 size={15} className="process-spin" /> : j.status === "done" ? <Check size={15} /> : <AlertCircle size={15} />}
              </span>
              <span className="bg-job-title" title={j.title}>{j.title || "회의록"}</span>
              <button className="bg-job-x" type="button" onClick={() => onDismiss(j.id)} aria-label="닫기"><X size={14} /></button>
            </div>
            {j.status === "processing" && (
              <>
                <div className="bg-job-bar"><span style={{ width: pct + "%" }} /></div>
                <div className="bg-job-meta">회의록 만드는 중 · {fmtClock(elapsed)}{eta ? ` / 예상 ~${Math.round(eta / 60)}분` : ""}</div>
              </>
            )}
            {j.status === "done" && (
              <div className="bg-job-meta bg-job-actions">
                <span>회의록 완료{j.notionError ? " · Notion 확인 필요" : j.notionUrl ? " · Notion 저장됨" : ""}</span>
                <button className="bg-job-view" type="button" onClick={() => onView(j)}>결과 보기</button>
              </div>
            )}
            {j.status === "error" && <div className="bg-job-meta">생성 실패{j.error ? ` · ${String(j.error).slice(0, 60)}` : ""}</div>}
            {j.status === "stalled" && <div className="bg-job-meta">서버에서 계속 처리 중일 수 있어요. Notion에서 확인하세요.</div>}
          </div>
        );
      })}
    </div>
  );
}

function StepPill({ active, done, label }) {
  return <div className={"step-pill " + (active ? "active" : done ? "done" : "")}>{label}</div>;
}

function FieldLabel({ title, optional = false, required = false }) {
  return <label className="label">{title}{required && <span className="required">필수</span>}{optional && <span className="optional">선택</span>}</label>;
}

function TagList({ items, onRemove, variant }) {
  if (!items.length) return null;
  return <div className="tags">{items.map((item) => <span key={item} className={"tag " + (variant === "dark" ? "dark" : "")} >{item}<button type="button" onClick={() => onRemove(item)} aria-label={item + " 삭제"}><X size={14} /></button></span>)}</div>;
}

function SummaryItem({ icon: Icon, label, value }) {
  return <div className="summary-item"><Icon size={18} /><div><p className="summary-label">{label}</p><p className="summary-value">{value}</p></div></div>;
}

function SourceButton({ active, icon: Icon, title, desc, onClick }) {
  return <button type="button" onClick={onClick} className={"source-btn " + (active ? "active" : "")}><div className="source-icon"><Icon size={20} /></div><p className="source-title">{title}</p><p className="source-desc">{desc}</p></button>;
}


function AudioTester({ selectedSource, audioLevel, audioTestState, audioTestMessage, onStart, onStop }) {
  const isReady = audioTestState === "ready";
  const isChecking = audioTestState === "checking";
  const isProblem = audioTestState === "error" || audioTestState === "no-signal";
  const bars = [12, 26, 42, 58, 74, 90];

  return (
    <div className={"audio-tester " + (isReady ? "ready" : isProblem ? "problem" : isChecking ? "checking" : "")}>
      <div className="tester-head">
        <div>
          <p className="tester-label">Speaker / Microphone tester</p>
          <h3>{selectedSource === "system" ? "온라인 회의 소리 확인" : "마이크 입력 확인"}</h3>
        </div>
        <div className={"tester-status " + audioTestState}>
          {isReady ? "인식 완료" : isChecking ? "확인 중" : isProblem ? "확인 필요" : "대기"}
        </div>
      </div>

      <div className="level-wrap">
        <div className="speaker-visual">
          <MonitorSpeaker size={22} />
          <div className="wave-bars">
            {bars.map((bar) => {
              const active = audioLevel >= bar;
              return <span key={bar} className={active ? "active" : ""} style={{ height: 10 + bar / 2 }} />;
            })}
          </div>
        </div>
        <div className="level-meter">
          <div style={{ width: audioLevel + "%" }} />
        </div>
      </div>

      <p className="tester-message">{audioTestMessage}</p>

      <div className="tester-actions">
        <button type="button" className="tester-btn" onClick={onStart}>
          {isChecking ? "다시 테스트" : "오디오 테스트"}
        </button>
        {(isChecking || isReady || isProblem) && <button type="button" className="tester-stop" onClick={onStop}>테스트 중지</button>}
      </div>
    </div>
  );
}

function EmptyState() {
  return <motion.div className="card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}><div className="card-inner" style={{ minHeight: 250, display: "grid", placeItems: "center", textAlign: "center" }}><div><div className="icon-box" style={{ margin: "0 auto 18px", width: 64, height: 64 }}><Mic size={30} /></div><h3 className="h2" style={{ fontSize: 22 }}>회의 준비가 끝나면 바로 시작하세요.</h3><p className="help">브라우저에서 바로 녹음하거나 오디오 파일을 선택한 뒤 회의록 만들기를 누르면 Notion에 자동 저장됩니다.</p></div></div></motion.div>;
}

function ProgressPanel({ recordingState }) {
  return <motion.div className="card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}><div className="card-inner"><h3 className="h2" style={{ fontSize: 22, marginBottom: 16 }}>실시간 진행</h3><div className="summary-row"><ProgressRow done label="오디오 입력 확인" /><ProgressRow done={recordingState === "recording"} label="회의 음성 녹음 중" /><ProgressRow done={false} label="종료 후 회의록 생성 및 Notion 자동 저장" /></div></div></motion.div>;
}

function ProgressRow({ done, label }) {
  return <div className="summary-item"><CheckCircle2 size={18} color={done ? "#10b981" : "#94a3b8"} /><p className="summary-value">{label}</p></div>;
}

function ProcessingLog({ logs }) {
  return <div className="process-log">
    <p className="process-title">진행 상황</p>
    {logs.map((log, index) => (
      <div key={index + log.label} className={"process-log-row " + (log.status || "")}>
        {log.status === "active"
          ? <Loader2 size={15} className="process-spin" />
          : log.status === "done"
            ? <CheckCircle2 size={15} className="process-check" />
            : <span className="process-dot" />}
        <span>{log.label}</span>
      </div>
    ))}
  </div>;
}

function LogsModal({ onClose }) {
  const [logs, setLogs] = useState(null);
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = (eo) => {
    setLoading(true);
    fetch(API_BASE_URL + "/api/logs/recent?limit=300&errors_only=" + (eo ? "true" : "false"), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setLogs(d.logs || []); setLoading(false); })
      .catch(() => { setLogs([]); setLoading(false); });
  };
  useEffect(() => { load(errorsOnly); }, [errorsOnly]);

  const kindLabel = (k) => k === "access" ? "이용" : k === "error" ? "API에러" : k === "job-error" ? "처리에러" : k?.startsWith("client") ? "브라우저" : k;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-head">
          <div>
            <h3 className="h2" style={{ fontSize: 22 }}>이용/에러 로그</h3>
            <p className="help">최근 7일 · {errorsOnly ? "에러만" : "전체"}{logs ? ` · ${logs.length}건` : ""}</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="stat-tabs">
          <button type="button" className={"stat-tab " + (errorsOnly ? "active" : "")} onClick={() => setErrorsOnly(true)}>에러만</button>
          <button type="button" className={"stat-tab " + (!errorsOnly ? "active" : "")} onClick={() => setErrorsOnly(false)}>전체 이용</button>
          <button type="button" className="stat-tab" onClick={() => load(errorsOnly)}>새로고침</button>
        </div>
        {loading ? (
          <p className="help" style={{ padding: "12px 0" }}><Loader2 size={15} className="process-spin" /> 불러오는 중…</p>
        ) : !logs?.length ? (
          <p className="help" style={{ padding: "12px 0" }}>기록이 없습니다.</p>
        ) : (
          <div className="stats-scroll" style={{ maxHeight: "62vh" }}>
            {logs.map((l, i) => (
              <div key={i} className={"log-row " + (l.kind !== "access" ? "log-err" : "")}>
                <div className="log-row-top">
                  <span className="log-kind">{kindLabel(l.kind)}</span>
                  <span className="log-ts">{l.ts}</span>
                  {l.user && <span className="log-user">{l.user}</span>}
                </div>
                <div className="log-body">
                  {l.path ? `${l.method || ""} ${l.path}${l.status ? " → " + l.status : ""}${l.ms != null ? " (" + l.ms + "ms)" : ""}` : ""}
                  {l.message ? l.message : ""}
                  {l.error ? " " + l.error : ""}
                  {l.context ? ` [${l.context}]` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingsListModal({ onClose, currentUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch(API_BASE_URL + "/api/meetings/list", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setData({ meetings: [] }); setLoading(false); });
  }, []);

  const openDetail = (id) => {
    setDetailLoading(true);
    setSelected({ loading: true });
    fetch(API_BASE_URL + "/api/meetings/detail/" + id, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSelected(d))
      .catch(() => setSelected({ error: "회의록을 열 수 없습니다." }))
      .finally(() => setDetailLoading(false));
  };

  const scope = "내가 만든";
  const meetings = data?.meetings || [];

  // ── 상세 보기 ──
  if (selected) {
    const notes = selected.notes || {};
    const segments = Array.isArray(selected.segments) ? selected.segments : [];
    const turns = [];
    for (const s of segments) {
      const last = turns[turns.length - 1];
      if (last && last.speaker === s.speaker) last.texts.push(s.text);
      else turns.push({ speaker: s.speaker || "", texts: [s.text] });
    }
    const sections = [
      { title: "요약", items: notes.summary ? [notes.summary] : [] },
      { title: "참석자", items: notes.attendees || [] },
      { title: "안건", items: notes.agenda || [] },
      { title: "핵심 논의", items: notes.key_points || [] },
      { title: "결정사항", items: notes.decisions || [] },
      { title: "추가 논의 필요", items: notes.open_questions || [] },
    ];
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
          <div className="modal-head">
            <div style={{ minWidth: 0 }}>
              <button className="back-btn" type="button" onClick={() => setSelected(null)}>← 목록</button>
              <h3 className="h2" style={{ fontSize: 20, marginTop: 8 }}>{notes.title || "회의록"}</h3>
              <p className="help">{[selected.department, selected.registrant, selected.meeting_date || selected.upload_date].filter(Boolean).join(" · ")}</p>
            </div>
            <button className="modal-close" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
          </div>
          {selected.loading || detailLoading ? (
            <p className="help" style={{ padding: "12px 0" }}><Loader2 size={15} className="process-spin" /> 불러오는 중…</p>
          ) : selected.error ? (
            <div className="error">{selected.error}</div>
          ) : (
            <div className="stats-scroll" style={{ maxHeight: "66vh" }}>
              {sections.map((sec) => sec.items.length > 0 && (
                <div key={sec.title} className="note-block"><h4>{sec.title}</h4><ul>{sec.items.map((it, i) => <li key={i}>{it}</li>)}</ul></div>
              ))}
              {notes.action_items?.length > 0 && (
                <div className="note-block"><h4>액션 아이템</h4><ul>{notes.action_items.map((it, i) => <li key={i}>{it.task} (담당: {it.owner || "미정"} / 기한: {it.due || "미정"})</li>)}</ul></div>
              )}
              {turns.length > 0 && (
                <div className="note-block"><h4>전사</h4>
                  {turns.map((t, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      {t.speaker && <span className="speaker">{t.speaker}</span>}
                      <p className="help" style={{ margin: "4px 0 0" }}>{t.texts.join(" ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 목록 ──
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <div>
            <h3 className="h2" style={{ fontSize: 22 }}>회의록 목록</h3>
            <p className="help">{scope} 회의록{data ? ` · ${meetings.length}건` : ""} · 클릭해서 내용 보기 · 다른 회의록은 Notion에서</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        {loading ? (
          <p className="help" style={{ padding: "12px 0" }}><Loader2 size={15} className="process-spin" /> 불러오는 중…</p>
        ) : meetings.length === 0 ? (
          <p className="help" style={{ padding: "12px 0" }}>볼 수 있는 회의록이 없습니다.</p>
        ) : (
          <div className="stats-scroll">
            {meetings.map((m) => (
              <button key={m.meeting_id} type="button" className="list-row list-row-btn" onClick={() => openDetail(m.meeting_id)}>
                <div className="list-row-main">
                  <b>{m.title}</b>
                  <span className="list-row-meta">{m.department}{m.registrant ? " · " + m.registrant : ""}{m.meeting_date ? " · " + m.meeting_date : ""}</span>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="stat-bars">
      {rows.map((r) => (
        <div key={r.name} className="stat-bar-row">
          <span className="stat-bar-name" title={r.name}>{r.name}</span>
          <div className="stat-bar-track"><div className="stat-bar-fill" style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></div>
          <span className="stat-bar-val">{r.count}건 · {r.minutes}분</span>
        </div>
      ))}
    </div>
  );
}

function StatsModal({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("registrant");

  useEffect(() => {
    fetch(API_BASE_URL + "/api/stats/monthly", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setData({ months: [], total_count: 0, by_registrant: [], by_department: [] }); setLoading(false); });
  }, []);

  const months = data?.months || [];
  const empty = !loading && (data?.total_count || 0) === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <div>
            <h3 className="h2" style={{ fontSize: 22 }}>이용 통계</h3>
            {data && <p className="help">전체 <b>{data.total_count}건</b> · 총 <b>{data.total_minutes}분</b></p>}
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        {loading ? (
          <p className="help" style={{ padding: "12px 0" }}><Loader2 size={15} className="process-spin" /> 불러오는 중…</p>
        ) : empty ? (
          <p className="help" style={{ padding: "12px 0" }}>아직 기록이 없습니다.</p>
        ) : (
          <>
            <div className="stat-tabs">
              {[["registrant", "등록자별"], ["department", "부서별"], ["month", "월별"]].map(([k, label]) => (
                <button key={k} type="button" className={"stat-tab " + (tab === k ? "active" : "")} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <div className="stats-scroll">
              {tab === "registrant" && <StatBars rows={data.by_registrant || []} />}
              {tab === "department" && <StatBars rows={data.by_department || []} />}
              {tab === "month" && months.map((m) => (
                <div key={m.month} className="stats-month">
                  <div className="stats-month-head">
                    <b>{m.month}</b>
                    <span>{m.count}건 · {m.minutes}분</span>
                  </div>
                  <div className="stats-tags">
                    {(m.by_registrant || []).map((r) => (
                      <span key={r.name} className="tag">{r.name} <b>{r.count}</b></span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result, notes, participants, emails, error, isProcessing, processingLogs, durationLabel, elapsedSec = 0, etaSec = 0, onSendEmail, isSendingEmail, manualEmailStatus, onReset, onBackground }) {
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [resultEmailInput, setResultEmailInput] = useState("");
  const [resultEmails, setResultEmails] = useState(emails || []);
  const [speakerMap, setSpeakerMap] = useState({});

  useEffect(() => {
    setResultEmails(emails || []);
  }, [emails]);

  // 새 결과가 오면 AI가 추측한 화자↔참가자 매핑으로 초기화(수정 가능)
  useEffect(() => {
    const guess = result?.speaker_guess;
    setSpeakerMap(guess && typeof guess === "object" ? { ...guess } : {});
  }, [result?.meeting_id]);

  const segments = Array.isArray(result?.segments) ? result.segments : [];
  // 등장 순서대로 고유 화자 목록
  const speakers = [];
  for (const s of segments) {
    if (s.speaker && !speakers.includes(s.speaker)) speakers.push(s.speaker);
  }
  const nameFor = (sp) => (speakerMap[sp] && speakerMap[sp].trim()) || sp;

  // 같은 화자의 연속 발화를 하나의 턴으로 묶기
  const turns = [];
  for (const s of segments) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) last.texts.push(s.text);
    else turns.push({ speaker: s.speaker || "", texts: [s.text] });
  }
  // segments가 없을 때(전사 실패 등)의 폴백: 전사본 텍스트를 줄단위로
  const fallbackLines = (!segments.length && result?.transcript)
    ? result.transcript.split("\n").filter(Boolean)
    : [];

  const addResultEmail = () => {
    const next = parseEmailInput(resultEmailInput);
    if (!next.length) return;
    setResultEmails((prev) => Array.from(new Set([...prev, ...next])));
    setResultEmailInput("");
  };

  const removeResultEmail = (email) => {
    setResultEmails((prev) => prev.filter((item) => item !== email));
  };

  const sendResultEmail = () => {
    if (!emailComposerOpen) {
      setEmailComposerOpen(true);
      return;
    }

    const typedEmails = parseEmailInput(resultEmailInput);
    const recipients = Array.from(new Set([...resultEmails, ...typedEmails].map((item) => String(item).trim()).filter(Boolean)));
    setResultEmails(recipients);
    setResultEmailInput("");
    onSendEmail(recipients);
  };

  const sections = notes ? [
    { title: "요약", items: notes.summary ? [notes.summary] : [] },
    { title: "참석자", items: notes.attendees || [] },
    { title: "안건", items: notes.agenda || [] },
    { title: "핵심 논의", items: notes.key_points || [] },
    { title: "결정사항", items: notes.decisions || [] },
    { title: "추가 논의 필요", items: notes.open_questions || [] },
  ] : [];

  const sentCount = result?.emailed_recipients?.length || emails.length;

  return <motion.div className="result-grid" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
    <div className="card"><div className="card-inner"><div className="section-title"><div><h3>회의 요약</h3><p>{durationLabel}짜리 회의 요약입니다. 회의록 생성 후 Notion에 자동 저장됩니다.</p></div><ListChecks size={24} color="#64748b" /></div>
      <div className="summary-scroll">
      {isProcessing && <div className="notice">{durationLabel}짜리 회의를 전사 → 화자 구분 → AI 요약 → Notion 저장 순서로 처리 중입니다. 회의가 길면 몇 분~수십 분 걸릴 수 있어요.</div>}
      {isProcessing && (
        <div className="progress-meter">
          <div className="progress-meter-head">
            <span><Loader2 size={14} className="process-spin" /> 경과 {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}</span>
            {etaSec > 0 && <span>예상 약 {Math.max(1, Math.round(etaSec / 60))}분</span>}
          </div>
          <div className="progress-bar"><div style={{ width: `${etaSec ? Math.min(99, Math.round((elapsedSec / etaSec) * 100)) : 5}%` }} /></div>
          {onBackground && (
            <button className="bg-toggle-btn" type="button" onClick={onBackground}>
              백그라운드로 돌리고 새 회의 준비하기
            </button>
          )}
          <p className="help" style={{ marginTop: 6 }}>화면을 닫거나 새로고침해도 처리는 계속됩니다. 오른쪽 아래에서 진행 상황을 볼 수 있어요.</p>
        </div>
      )}
      {processingLogs?.length > 0 && <ProcessingLog logs={processingLogs} />}
      {!isProcessing && !notes && <div className="notice">아직 생성된 회의록이 없습니다.</div>}
      {sections.map((section) => section.items.length > 0 && <div key={section.title} className="note-block"><h4>{section.title}</h4><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
      {notes?.action_items?.length > 0 && <div className="note-block"><h4>액션 아이템</h4><ul>{notes.action_items.map((item, idx) => <li key={idx}>{item.task} (담당: {item.owner || "미정"} / 기한: {item.due || "미정"})</li>)}</ul></div>}
      {result?.notion_url && <div className="success">Notion 자동 저장 완료: <a href={result.notion_url} target="_blank" rel="noreferrer">열기 <ExternalLink size={13} /></a></div>}
      {result?.notion_error && <div className="error">Notion 저장 실패: {result.notion_error}</div>}
      {result?.email_sent && <div className="success">이메일 전달 완료: {sentCount}명</div>}
      {result?.email_error && <div className="error">이메일 전달 실패: {result.email_error}</div>}
      {error && <div className="error">{error}</div>}
      </div>
    </div></div>

    <div className="stack"><div className="card"><div className="card-inner"><div className="section-title"><h3>전사 미리보기</h3><FileText size={24} color="#64748b" /></div>
      {speakers.length > 0 && (
        <div className="speaker-map">
          <p className="speaker-map-title">화자 매칭 <span className="speaker-map-hint">(AI 추측 · 수정 가능)</span></p>
          <datalist id="participant-options">{(participants || []).map((p) => <option key={p} value={p} />)}</datalist>
          <div className="speaker-map-grid">
            {speakers.map((sp) => (
              <div key={sp} className="speaker-map-row">
                <span className="speaker">{sp}</span>
                <span className="speaker-map-arrow">→</span>
                <input
                  className="input speaker-map-input"
                  list="participant-options"
                  placeholder={"그대로 (" + sp + ")"}
                  value={speakerMap[sp] || ""}
                  onChange={(e) => setSpeakerMap((m) => ({ ...m, [sp]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="transcript-scroll">
        {turns.length > 0
          ? turns.map((t, idx) => (
              <div key={idx} className="transcript-item">
                {t.speaker && <span className="speaker">{nameFor(t.speaker)}</span>}
                <p className="help">{t.texts.join(" ")}</p>
              </div>
            ))
          : fallbackLines.length > 0
            ? fallbackLines.map((line, idx) => (
                <div key={idx} className="transcript-item"><p className="help">{line}</p></div>
              ))
            : <p className="help">전사 내용이 아직 없습니다.</p>}
      </div>
    </div></div>
    <div className="card"><div className="card-inner"><h3 className="h2" style={{ fontSize: 22, marginBottom: 16 }}>최종 처리</h3>{onReset && <button className="final-btn" onClick={onReset}><RotateCcw size={18} /> 새 회의 시작</button>}<button className="outline-btn" disabled style={{ marginBottom: 10 }}><Save size={18} /> Notion 자동 저장됨</button><button className="outline-btn" disabled={!notes || isProcessing || isSendingEmail} onClick={sendResultEmail}><Send size={18} /> {isSendingEmail ? "이메일 보내는 중" : emailComposerOpen ? "입력한 이메일로 보내기" : "이메일 보내기"}{emailComposerOpen && resultEmails.length ? " (" + resultEmails.length + "명)" : ""}</button><p className="notice">Notion 업로드가 끝난 뒤에도 원하면 이메일을 보낼 수 있습니다. 이메일을 입력하고 바로 보내기를 눌러도 입력 중인 주소까지 함께 발송됩니다.</p>
      {emailComposerOpen && <div className="result-email-box"><div className="input-row"><input className="input" value={resultEmailInput} onChange={(e) => setResultEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addResultEmail(); } }} placeholder="이메일 입력 후 Enter 또는 추가" /><button className="add-btn" type="button" onClick={addResultEmail}><Plus size={20} /></button></div><TagList items={resultEmails} onRemove={removeResultEmail} variant="dark" />{!resultEmails.length && <p className="help">여러 명에게 보내려면 쉼표, 세미콜론, 줄바꿈 또는 Enter로 구분하세요.</p>}</div>}
      {manualEmailStatus && <div className={manualEmailStatus.includes("완료") ? "success" : manualEmailStatus.includes("오류") || manualEmailStatus.includes("실패") ? "error" : "notice"}>{manualEmailStatus}</div>}</div></div></div>
  </motion.div>;
}
