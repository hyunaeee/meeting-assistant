"""
pyannote.audio 를 사용한 화자 분리(diarization).
- HF_TOKEN 이 필요하며, HuggingFace 에서 아래 두 모델의 사용 약관에 동의해야 한다.
  * pyannote/speaker-diarization-3.1
  * pyannote/segmentation-3.0
- 실패 시 예외를 던지며, 호출부(main)에서 화자 없이 폴백한다.
"""
from pathlib import Path

from app import config

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        if not config.HF_TOKEN:
            raise RuntimeError("HF_TOKEN 이 없어 화자 분리를 사용할 수 없습니다.")
        import torch
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=config.HF_TOKEN,
        )
        if pipeline is None:
            raise RuntimeError(
                "화자 분리 모델을 불러오지 못했습니다. HF 계정에서 "
                "pyannote/speaker-diarization-3.1 및 pyannote/segmentation-3.0 약관에 "
                "동의했는지, HF_TOKEN 이 유효한지 확인하세요."
            )
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
        _pipeline = pipeline
    return _pipeline


def preload_pipeline() -> None:
    """앱 시작 시 화자 분리 파이프라인을 미리 로드한다(선택)."""
    _get_pipeline()


def diarize(wav_path: Path) -> list[dict]:
    """[{"start": float, "end": float, "speaker": str(raw)}] 를 시간순으로 반환."""
    pipeline = _get_pipeline()
    annotation = pipeline(str(wav_path))
    turns = []
    for turn, _track, speaker in annotation.itertracks(yield_label=True):
        turns.append({"start": float(turn.start), "end": float(turn.end), "speaker": speaker})
    turns.sort(key=lambda t: t["start"])
    return turns


def assign_speakers(segments: list[dict], turns: list[dict]) -> list[dict]:
    """각 전사 세그먼트에 가장 많이 겹치는 화자를 부여하고 라벨을 '화자 N'으로 정규화한다.
    (등장 순서대로 화자 1, 화자 2 ...)
    """
    label_map: dict[str, str] = {}

    def normalized(raw: str) -> str:
        if raw not in label_map:
            label_map[raw] = f"화자 {len(label_map) + 1}"
        return label_map[raw]

    for seg in segments:
        best_speaker = None
        best_overlap = 0.0
        for turn in turns:
            overlap = min(seg["end"], turn["end"]) - max(seg["start"], turn["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn["speaker"]
        seg["speaker"] = normalized(best_speaker) if best_speaker is not None else "화자 1"

    return segments
