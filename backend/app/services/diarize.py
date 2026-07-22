"""
pyannote.audio 를 사용한 화자 분리(diarization).

- HF_TOKEN 필요. HuggingFace 에서 pyannote/speaker-diarization-3.1 및
  pyannote/segmentation-3.0 약관에 동의해야 한다.
- 세그멘테이션/임베딩은 GPU 에서 빠르지만(수십 배속), 뒤의 클러스터링이 임베딩
  개수의 O(n²)로 폭증한다. 그래서 긴 오디오는 청크(기본 5분)로 나눠 각각 분리하고,
  청크별 화자 임베딩을 코사인 유사도로 비교해 전체 화자로 병합한다.
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

        # Ampere+(예: 4090)에서 matmul 가속
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

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


def _cosine(a, b) -> float:
    import numpy as np

    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return -1.0
    return float(np.dot(a, b) / (na * nb))


def _diarize_annotation(waveform, sample_rate):
    pipeline = _get_pipeline()
    annotation = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    turns = [
        {"start": float(turn.start), "end": float(turn.end), "speaker": speaker}
        for turn, _track, speaker in annotation.itertracks(yield_label=True)
    ]
    turns.sort(key=lambda t: t["start"])
    return turns


def diarize(wav_path: Path) -> list[dict]:
    """[{"start","end","speaker"}] 를 시간순으로 반환.

    긴 오디오는 청크로 나눠 처리하고 임베딩으로 화자를 전체 병합한다.
    """
    import numpy as np
    import torchaudio

    pipeline = _get_pipeline()
    waveform, sr = torchaudio.load(str(wav_path))
    if waveform.shape[0] > 1:  # 혹시 스테레오면 모노로
        waveform = waveform.mean(dim=0, keepdim=True)
    total = int(waveform.shape[1])
    chunk = int(config.DIARIZE_CHUNK_SEC * sr)

    # 청크보다 짧으면 한 번에
    if total <= chunk:
        return _diarize_annotation(waveform, sr)

    threshold = config.DIARIZE_MERGE_THRESHOLD
    centroids: list[list] = []  # [[embedding(np.array)|None, count], ...]
    turns: list[dict] = []

    def match(emb) -> int:
        if emb is None or not np.all(np.isfinite(emb)):
            centroids.append([None, 0])
            return len(centroids) - 1
        best_i, best_s = -1, -1.0
        for i, (c, _n) in enumerate(centroids):
            if c is None:
                continue
            s = _cosine(emb, c)
            if s > best_s:
                best_s, best_i = s, i
        if best_i >= 0 and best_s >= threshold:
            c, n = centroids[best_i]
            centroids[best_i] = [(c * n + emb) / (n + 1), n + 1]
            return best_i
        centroids.append([emb.astype(float).copy(), 1])
        return len(centroids) - 1

    start = 0
    while start < total:
        seg = waveform[:, start:start + chunk]
        if seg.shape[1] >= sr:  # 1초 이상만
            annotation, embeddings = pipeline(
                {"waveform": seg, "sample_rate": sr}, return_embeddings=True
            )
            labels = list(annotation.labels())
            label_to_global: dict[str, int] = {}
            for i, lbl in enumerate(labels):
                emb = None
                if embeddings is not None and i < len(embeddings):
                    emb = np.asarray(embeddings[i], dtype=float)
                label_to_global[lbl] = match(emb)
            offset = start / sr
            for turn, _track, lbl in annotation.itertracks(yield_label=True):
                turns.append({
                    "start": float(turn.start) + offset,
                    "end": float(turn.end) + offset,
                    "speaker": f"S{label_to_global[lbl]}",
                })
        start += chunk

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
