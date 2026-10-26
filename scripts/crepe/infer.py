"""Offline, aligned CREPE inference. torchcrepe weights; original CREPE decoder.
The original local-average decoder is credited in NOTICE. No Viterbi, dithering,
median filter, label-dependent choices, or production imports.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import resource
import time
import numpy as np
import psutil
import resampy
import torch
import torchcrepe
from verify_models import MODELS


def local_average_hz(activation):
    """Official CREPE ±4-bin weighted cents average, without torchcrepe dithering."""
    centres = np.argmax(activation, axis=1)
    mapping = np.arange(360, dtype=np.float64) * 20 + 1997.3794084376191
    values = []
    for row, centre in zip(activation, centres):
        lo, hi = max(0, int(centre) - 4), min(360, int(centre) + 5)
        weights = row[lo:hi].astype(np.float64)
        values.append(float(10 * 2 ** (np.sum(weights * mapping[lo:hi]) / np.sum(weights) / 1200)))
    return values


def aligned_frames(samples, centres, original_rate=22050):
    audio = resampy.resample(samples, original_rate, 16000, filter="kaiser_best", parallel=False)
    rounded = np.rint(np.asarray(centres, dtype=np.float64) * 16000 / original_rate).astype(np.int64)
    # All output centres have the Standard half-window guard; padding is unnecessary.
    assert np.all(rounded >= 512) and np.all(rounded + 512 <= len(audio))
    frames = np.stack([audio[c - 512:c + 512] for c in rounded]).astype(np.float32)
    frames -= frames.mean(axis=1, keepdims=True)
    frames /= np.clip(frames.std(axis=1, keepdims=True), 1e-8, None)
    errors = rounded / 16000 - np.asarray(centres) / original_rate
    return frames, float(np.abs(errors).max(initial=0))


def run(capacity, root):
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    manifest_bytes = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    provenance = json.loads(Path("work/crepe/provenance/verified.json").read_text())
    verified = next(p for p in provenance if p["capacity"] == capacity)
    weights = Path(torchcrepe.__file__).parent / "assets" / f"{capacity}.pth"
    assert hashlib.sha256(weights.read_bytes()).hexdigest() == MODELS[capacity]["pth"]
    assert verified["exactlyMatchingTensors"] == 38
    process = psutil.Process()
    before_rss = process.memory_info().rss
    start = time.perf_counter()
    torchcrepe.load.model("cpu", capacity)
    load_ms = (time.perf_counter() - start) * 1000
    loaded_rss = process.memory_info().rss
    # Pay resampler JIT and first-convolution initialization outside measured cases.
    start = time.perf_counter()
    warm = np.sin(np.arange(22050, dtype=np.float32) * (2 * np.pi * 146.832 / 22050))
    warm_frames, _ = aligned_frames(warm, [2048, 2560, 3072, 3584])
    with torch.inference_mode():
        for frame in warm_frames:
            torchcrepe.infer(torch.from_numpy(frame[None]), capacity)
    warm_ms = (time.perf_counter() - start) * 1000
    output = {"schemaVersion":1, "model":capacity, "manifestSha256":hashlib.sha256(manifest_bytes).hexdigest(),
        "settings":{"threads":1,"interopThreads":1,"batchSize":1,"device":"cpu","dtype":"float32","decoder":"official-local-average","repetitions":1,"amplitudeGate":0.003},
        "environment":{"python":platform.python_version(), "torch":torch.__version__, "packages":{name:importlib.metadata.version(name) for name in ["torchcrepe","numpy","scipy","resampy","librosa"]}},
        "modelLoadMs":load_ms,"warmupMs":warm_ms,"rssBeforeLoadBytes":before_rss,"rssAfterLoadBytes":loaded_rss,"provenance":verified,"cases":[]}
    def save():
        output["processPeakRssKiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        (root / f"{capacity}.json").write_text(json.dumps(output, indent=2, allow_nan=False))
    save()
    for case in manifest["cases"]:
        data = (root / case["pcmFile"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == case["pcmSha256"]
        samples = np.frombuffer(data, dtype="<f4")
        start, cpu = time.perf_counter(), time.process_time()
        frames, alignment_error = aligned_frames(samples, case["centres"])
        preparation_ms, preparation_cpu = (time.perf_counter()-start)*1000, (time.process_time()-cpu)*1000
        frequency, confidence, frame_ms = [], [], []
        start, cpu = time.perf_counter(), time.process_time()
        with torch.inference_mode():
            for i, frame in enumerate(frames):
                if case["rms"][i] < 0.003:
                    frequency.append(None); confidence.append(0.0)
                    continue
                tick = time.perf_counter()
                activation = torchcrepe.infer(torch.from_numpy(frame[None]), capacity).numpy()
                frequency.extend(local_average_hz(activation))
                confidence.append(float(activation.max()))
                frame_ms.append((time.perf_counter()-tick)*1000)
        inference_ms, inference_cpu = (time.perf_counter()-start)*1000, (time.process_time()-cpu)*1000
        output["cases"].append({"id":case["id"],"frequency":frequency,"confidence":confidence,"maxAlignmentErrorSeconds":alignment_error,
            "framesInferred":len(frame_ms),"belowAmplitudeThreshold":len(frames)-len(frame_ms),
            "timing":{"preparationMs":preparation_ms,"inferenceAndDecodeMs":inference_ms,"totalMs":preparation_ms+inference_ms,"cpuMs":preparation_cpu+inference_cpu,
            "inferenceFrameMedianMs":float(np.median(frame_ms)) if frame_ms else None,"inferenceFrameP95Ms":float(np.quantile(frame_ms,.95)) if frame_ms else None},
            "processPeakRssKiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
        save()
        print(capacity,case["id"],len(frames),f"{(preparation_ms+inference_ms)/1000:.2f}s",flush=True)
    output["completed"] = True
    save()

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("model",choices=["tiny","full"])
    parser.add_argument("--directory",default="work/crepe/run")
    args=parser.parse_args()
    run(args.model,Path(args.directory))
