"""Plot saved audit outputs. Requires matplotlib/numpy; never modifies app or audio."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--input", default="work/fast-pitch")
parser.add_argument("--output", default="docs/figures")
parser.add_argument("--audio", help="Optional original Bach audio, used for a spectrogram")
args = parser.parse_args()
source, destination = Path(args.input), Path(args.output)
destination.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.size": 10, "svg.fonttype": "none"})

with (source / "real-frames.csv").open() as file:
    frames = list(csv.DictReader(file))
with (source / "real-tone.csv").open() as file:
    tone = list(csv.DictReader(file))
real = json.loads((source / "real.json").read_text())
duration = real["provenance"]["decodedSeconds"]
fig, axes = plt.subplots(5 if args.audio else 4, 1, figsize=(12, 12 if args.audio else 10), sharex=True, layout="constrained")
start = 0
if args.audio:
    assert hashlib.sha256(Path(args.audio).read_bytes()).hexdigest() == real["provenance"]["sha256"], "Audio does not match saved audit"
    # Stereo averaging matches production for this file (no severe phase cancellation).
    channels = real["provenance"]["metadata"]["streams"][0]["channels"]
    data = subprocess.check_output(["ffmpeg", "-v", "error", "-i", args.audio, "-ar", "22050", "-ac", str(channels), "-f", "f32le", "pipe:1"])
    pcm = np.frombuffer(data, dtype="<f4").reshape(-1, channels)
    mono = pcm.mean(axis=1)
    energy = (pcm ** 2).sum(axis=0)
    if (mono ** 2).sum() < energy.max() * 0.1:
        mono = pcm[:, energy.argmax()]
    axes[0].specgram(mono, NFFT=2048, Fs=22050, noverlap=1792, cmap="magma", vmin=-90, vmax=-30)
    axes[0].set_ylim(50, 1000)
    axes[0].set_ylabel("Spectrum (Hz)")
    axes[0].set_title("2048-sample spectrogram: spectral energy, not note labels; colours are relative PSD")
    start = 1
for index, window in enumerate([4096, 2048, 1024]):
    ax = axes[start + index]
    selected = [f for f in frames if int(f["window"]) == window]
    usable = [f for f in selected if f["frequency"]]
    missing = [f for f in selected if not f["frequency"] and f["rejection"] != "silence"]
    quiet = [f for f in selected if f["rejection"] == "silence"]
    ax.scatter([float(f["time"]) for f in usable], [float(f["frequency"]) for f in usable], s=6, color="#007c83", label="Accepted estimate")
    ax.scatter([float(f["time"]) for f in missing], [58] * len(missing), marker="|", s=22, color="#b13b45", label="Withheld (non-quiet)")
    ax.scatter([float(f["time"]) for f in quiet], [58] * len(quiet), marker="|", s=22, color="#999999", label="Below RMS floor")
    ax.set_yscale("log")
    ax.set_ylim(53, 1050)
    ax.set_yticks([65.4, 110, 220, 440, 880], labels=["65", "110", "220", "440", "880"])
    ax.set_ylabel("Estimated Hz")
    ax.set_title(f"{window} samples / {window / 22.05:.1f} ms: {len(usable)}/{len(selected)} usable frames")
    ax.grid(alpha=0.15)
    if index == 0:
        ax.legend(loc="upper right", ncol=3, fontsize=8)
ax = axes[-1]
ax.plot([float(f["time"]) for f in tone], [float(f["flux"]) if f["flux"] else np.nan for f in tone], color="#305899", lw=0.8)
ax.axhline(real["rows"][0]["tone"]["fluxThreshold"], color="#b13b45", ls="--", label="Existing adaptive flux threshold")
for event in real["rows"][0]["tone"]["events"]:
    ax.axvline(event["time"], color="#888888", alpha=0.3, lw=0.7)
ax.set_ylabel("Spectral flux")
ax.set_xlabel("Decoded audio time (seconds)")
ax.set_title("Phase 2B flux; grey lines are acoustic proposals, not verified note onsets")
ax.legend(loc="upper right", fontsize=8)
ax.set_xlim(0, duration)
fig.suptitle("Bach excerpt — unlabelled audio: coverage and acoustic evidence, not pitch accuracy", fontsize=13)
fig.savefig(destination / "fast-pitch-real.svg")
fig.savefig(source / "real-preview.png", dpi=120)
plt.close(fig)

synthetic = json.loads((source / "synthetic.json").read_text())
chosen = ["low-0.125-clean", "low-0.08-clean", "arpeggio-0.125-clean", "arpeggio-0.08-clean", "arpeggio-0.125-resonance", "sustained-C2-minus12c"]
fig, axes = plt.subplots(2, 3, figsize=(13, 7), layout="constrained")
for ax, name in zip(axes.flat, chosen):
    case = next(c for c in synthetic if c["id"] == name)
    left = np.zeros(3)
    for field, colour, label in [("correct", "#007c83", "Within 50 cents"), ("wrong", "#c45149", "Outside 50 cents"), ("withheld", "#c5cbd3", "Withheld")]:
        values = np.array([100 * row["commonFrames"][field] / row["commonFrames"]["total"] for row in case["rows"]])
        ax.barh([0, 1, 2], values, left=left, color=colour, label=label)
        left += values
    ax.set_yticks([0, 1, 2], ["4096", "2048", "1024"])
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_title(name.replace("-clean", "").replace("-", " "), fontsize=10)
    ax.set_xlabel("% of matched frame centres")
    ax.set_ylabel("Window samples")
handles, labels = axes[0, 0].get_legend_handles_labels()
fig.legend(handles, labels, loc="outside lower center", ncol=3)
fig.suptitle("Controlled synthetic sequences: coverage gains can include incorrect estimates\nKnown active oscillator; lingering resonance is deliberately conflicting audio", fontsize=12)
fig.savefig(destination / "fast-pitch-synthetic.svg")
fig.savefig(source / "synthetic-preview.png", dpi=120)
plt.close(fig)
for filename in ("fast-pitch-real.svg", "fast-pitch-synthetic.svg"):
    path = destination / filename
    path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
print(f"Wrote audit figures to {destination}")
