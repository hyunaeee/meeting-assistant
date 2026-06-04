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


def transcribe_audio(audio_path: Path) -> str:
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

    lines = []
    for segment in segments:
        start = _format_time(segment.start)
        end = _format_time(segment.end)
        text = segment.text.strip()
        if text:
            lines.append(f"[{start} - {end}] {text}")

    if not lines:
        raise RuntimeError("전사 결과가 비어 있습니다. 오디오가 무음이었거나 온라인 회의 오디오 공유가 정상적으로 녹음되지 않았을 수 있습니다.")

    return "\n".join(lines)


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
