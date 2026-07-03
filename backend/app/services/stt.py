import subprocess
from pathlib import Path
from app import config

_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(
            config.WHISPER_MODEL,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE_TYPE,
        )
    return _model


def preload_model() -> None:
    """앱 시작 시 모델을 미리 로드해 첫 요청의 콜드스타트 지연(→ 프록시 504)을 방지한다."""
    _get_model()


def transcribe_segments(audio_path: Path):
    """전사 세그먼트 목록과 변환된 wav 경로를 반환한다.
    segments = [{"start": float, "end": float, "text": str}] (시간순)
    """
    if not audio_path.exists():
        raise FileNotFoundError(str(audio_path))

    if audio_path.stat().st_size < 1024:
        raise RuntimeError("오디오 파일이 너무 작습니다. 온라인 회의 오디오 공유 또는 마이크 입력을 다시 확인해주세요.")

    wav_path = _convert_to_wav(audio_path)
    model = _get_model()
    language = config.WHISPER_LANGUAGE or None
    segments, _info = model.transcribe(
        str(wav_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    out = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            out.append({"start": float(segment.start), "end": float(segment.end), "text": text})

    if not out:
        raise RuntimeError("전사 결과가 비어 있습니다. 오디오가 무음이었거나 온라인 회의 오디오 공유가 정상적으로 녹음되지 않았을 수 있습니다.")

    return out, wav_path


def segments_to_text(segments: list[dict], include_speaker: bool = True) -> str:
    """세그먼트 목록을 전사본 문자열로 변환한다.
    include_speaker=True 면 speaker 라벨(화자 N)을 앞에 붙인다.
    """
    lines = []
    for s in segments:
        speaker = s.get("speaker") or ""
        prefix = f"[{speaker}] " if (include_speaker and speaker) else ""
        lines.append(f"{prefix}[{_format_time(s['start'])} - {_format_time(s['end'])}] {s['text']}")
    return "\n".join(lines)


def transcribe_audio(audio_path: Path) -> str:
    segments, _wav = transcribe_segments(audio_path)
    return segments_to_text(segments)


def _convert_to_wav(audio_path: Path) -> Path:
    """브라우저 녹음 webm/ogg/mp4를 Whisper에 안정적인 16kHz mono wav로 변환합니다."""
    wav_path = audio_path.with_suffix(".16k.wav")
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(wav_path),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("오디오 변환 시간이 초과되었습니다. 녹음 파일이 너무 크거나 손상되었을 수 있습니다.") from exc

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "알 수 없는 ffmpeg 오류"
        raise RuntimeError(f"오디오 변환 실패: {message}")

    if not wav_path.exists() or wav_path.stat().st_size < 1024:
        raise RuntimeError("오디오 변환 결과가 비어 있습니다. 온라인 회의에서 오디오 공유가 켜져 있는지 확인해주세요.")

    return wav_path


def _format_time(seconds: float) -> str:
    total = int(seconds)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d}"
