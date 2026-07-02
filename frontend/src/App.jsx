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
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const DEFAULT_NOTION_LOCATION = "LIKE Notion AI 회의록";
const DEFAULT_NOTION_DESCRIPTION = "기본 회의록 페이지";
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
    fetch(API_BASE_URL + "/api/meetings/departments")
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

    const baseLogs = [
      { label: formatDuration(durationForRequest) + "짜리 회의 요약을 시작합니다", status: "done" },
      { label: "녹음 파일 준비", status: "done" },
      { label: "서버로 녹음 파일 전송 중", status: "active" },
    ];
    setProcessingLogs(baseLogs);

    const timedMessages = [
      "음성 파일을 분석 가능한 형식으로 변환 중",
      "Whisper가 회의 음성을 텍스트로 변환 중",
      "전사본을 정리하고 회의 내용을 확인 중",
      "Claude가 회의 요약 JSON을 생성 중",
      "Notion에 회의록 페이지를 저장 중",
      emails.length ? "이메일 전달 준비 중" : "최종 결과를 정리 중",
    ];
    let messageIndex = 0;
    const progressTimer = window.setInterval(() => {
      const message = timedMessages[Math.min(messageIndex, timedMessages.length - 1)];
      setProcessingLogs((prev) => {
        const withoutActive = prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log);
        const alreadyExists = withoutActive.some((log) => log.label === message);
        if (alreadyExists) return withoutActive;
        return [...withoutActive, { label: message, status: "active" }];
      });
      messageIndex += 1;
    }, 6500);

    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("title", meetingTitle.trim());
      form.append("participants", JSON.stringify(participants));
      form.append("emails", JSON.stringify(emails));
      form.append("duration_seconds", String(durationForRequest || 0));
      form.append("department", selectedDepartment);
      form.append("registrant", registrant.trim());

      // 1) 업로드 → 즉시 job_id 수신 (요청이 짧아 프록시 60초 타임아웃 회피)
      const startResp = await fetch(API_BASE_URL + "/api/meetings/process", {
        method: "POST",
        body: form,
      });
      const startData = await startResp.json();
      if (!startResp.ok || !startData.job_id) {
        throw new Error(startData.detail || startData.error || "회의록 생성 요청 실패");
      }

      // 2) 완료될 때까지 상태 폴링 (각 요청도 짧아 타임아웃 안 걸림)
      const deadlineAt = Date.now() + 30 * 60 * 1000; // 최대 30분 대기
      let data = null;
      while (true) {
        if (Date.now() > deadlineAt) {
          throw new Error("회의록 생성 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        const statusResp = await fetch(
          API_BASE_URL + "/api/meetings/status/" + startData.job_id
        );
        const statusData = await statusResp.json();
        if (statusResp.status === 404) {
          throw new Error("작업을 찾을 수 없습니다. 서버가 재시작되었을 수 있습니다.");
        }
        if (!statusResp.ok) {
          throw new Error(statusData.detail || statusData.error || "상태 확인 실패");
        }
        if (statusData.status === "done") {
          data = statusData.result;
          break;
        }
        if (statusData.status === "error") {
          throw new Error(statusData.error || "회의록 생성 실패");
        }
        // status === "processing" → 계속 폴링
      }
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
    } catch (err) {
      if (err.name === "AbortError") {
        setError("회의록 생성 시간이 너무 오래 걸려 중단되었습니다. 녹음 길이를 줄이거나 파일 업로드 방식으로 다시 시도해주세요.");
      } else {
        setError(err.message || "회의록 생성 중 오류가 발생했습니다.");
      }
      setProcessingLogs((prev) => [...prev.map((log) => log.status === "active" ? { ...log, status: "done" } : log), { label: "회의록 생성 중 오류 발생", status: "error" }]);
    } finally {
      window.clearInterval(progressTimer);
      setIsProcessing(false);
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
        headers: { "Content-Type": "application/json" },
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
              <h1 className="logo-title">LIKE meeting assistant</h1>
              <p className="logo-sub">{status}</p>
            </div>
          </div>
          <div className="steps">
            <StepPill active={step === "setup"} done={step !== "setup"} label="설정" />
            <ChevronRight size={16} color="#cbd5e1" />
            <StepPill active={step === "recording"} done={step === "result"} label="녹음" />
            <ChevronRight size={16} color="#cbd5e1" />
            <StepPill active={step === "result"} done={false} label="결과" />
          </div>
        </div>
      </header>

      <section className="container">
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
                <FieldLabel title="부서" />
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
                <FieldLabel title="등록자" />
                <input
                  className="input"
                  value={registrant}
                  onChange={(e) => setRegistrant(e.target.value)}
                  placeholder="회의록을 등록하는 사람 이름"
                />
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

        <section className="stack">
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

          {step === "setup" && <EmptyState />}
          {step === "recording" && <ProgressPanel recordingState={recordingState} />}
          {step === "result" && <ResultPanel result={result} notes={notes} participants={participants} emails={emails} error={error} isProcessing={isProcessing} processingLogs={processingLogs} durationLabel={displayDuration} onSendEmail={sendEmailAfterMeeting} isSendingEmail={isSendingEmail} manualEmailStatus={manualEmailStatus} />}
        </section>
      </section>
    </main>
  );
}

function StepPill({ active, done, label }) {
  return <div className={"step-pill " + (active ? "active" : done ? "done" : "")}>{label}</div>;
}

function FieldLabel({ title, optional = false }) {
  return <label className="label">{title}{optional && <span className="optional">선택</span>}</label>;
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
        <span className="process-dot" />
        <span>{log.label}</span>
      </div>
    ))}
  </div>;
}

function ResultPanel({ result, notes, participants, emails, error, isProcessing, processingLogs, durationLabel, onSendEmail, isSendingEmail, manualEmailStatus }) {
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [resultEmailInput, setResultEmailInput] = useState("");
  const [resultEmails, setResultEmails] = useState(emails || []);
  const [speakerMap, setSpeakerMap] = useState({});

  useEffect(() => {
    setResultEmails(emails || []);
  }, [emails]);

  // 새 결과가 오면 화자 매칭 초기화
  useEffect(() => {
    setSpeakerMap({});
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
      {isProcessing && <div className="notice">{durationLabel}짜리 회의를 전사, Claude 요약, Notion 자동 저장 순서로 처리 중입니다.</div>}
      {processingLogs?.length > 0 && <ProcessingLog logs={processingLogs} />}
      {!isProcessing && !notes && <div className="notice">아직 생성된 회의록이 없습니다.</div>}
      {sections.map((section) => section.items.length > 0 && <div key={section.title} className="note-block"><h4>{section.title}</h4><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
      {notes?.action_items?.length > 0 && <div className="note-block"><h4>액션 아이템</h4><ul>{notes.action_items.map((item, idx) => <li key={idx}>{item.task} (담당: {item.owner || "미정"} / 기한: {item.due || "미정"})</li>)}</ul></div>}
      {result?.notion_url && <div className="success">Notion 자동 저장 완료: <a href={result.notion_url} target="_blank" rel="noreferrer">열기 <ExternalLink size={13} /></a></div>}
      {result?.notion_error && <div className="error">Notion 저장 실패: {result.notion_error}</div>}
      {result?.email_sent && <div className="success">이메일 전달 완료: {sentCount}명</div>}
      {result?.email_error && <div className="error">이메일 전달 실패: {result.email_error}</div>}
      {error && <div className="error">{error}</div>}
    </div></div>

    <div className="stack"><div className="card"><div className="card-inner"><div className="section-title"><h3>전사 미리보기</h3><FileText size={24} color="#64748b" /></div>
      {speakers.length > 0 && (
        <div className="speaker-map">
          <p className="speaker-map-title">화자 매칭 <span className="speaker-map-hint">(원하면 참가자로 지정)</span></p>
          <datalist id="participant-options">{(participants || []).map((p) => <option key={p} value={p} />)}</datalist>
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
    <div className="card"><div className="card-inner"><h3 className="h2" style={{ fontSize: 22, marginBottom: 16 }}>최종 처리</h3><button className="final-btn" disabled><Save size={18} /> Notion 자동 저장</button><button className="outline-btn" disabled={!notes || isProcessing || isSendingEmail} onClick={sendResultEmail}><Send size={18} /> {isSendingEmail ? "이메일 보내는 중" : emailComposerOpen ? "입력한 이메일로 보내기" : "이메일 보내기"}{emailComposerOpen && resultEmails.length ? " (" + resultEmails.length + "명)" : ""}</button><p className="notice">Notion 업로드가 끝난 뒤에도 원하면 이메일을 보낼 수 있습니다. 이메일을 입력하고 바로 보내기를 눌러도 입력 중인 주소까지 함께 발송됩니다.</p>
      {emailComposerOpen && <div className="result-email-box"><div className="input-row"><input className="input" value={resultEmailInput} onChange={(e) => setResultEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addResultEmail(); } }} placeholder="이메일 입력 후 Enter 또는 추가" /><button className="add-btn" type="button" onClick={addResultEmail}><Plus size={20} /></button></div><TagList items={resultEmails} onRemove={removeResultEmail} variant="dark" />{!resultEmails.length && <p className="help">여러 명에게 보내려면 쉼표, 세미콜론, 줄바꿈 또는 Enter로 구분하세요.</p>}</div>}
      {manualEmailStatus && <div className={manualEmailStatus.includes("완료") ? "success" : manualEmailStatus.includes("오류") || manualEmailStatus.includes("실패") ? "error" : "notice"}>{manualEmailStatus}</div>}</div></div></div>
  </motion.div>;
}
