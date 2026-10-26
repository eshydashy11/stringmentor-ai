"""Verify installed torchcrepe tensors against immutable official CREPE weights.
Downloads public models/reference arrays only; never uploads audio.
"""
from pathlib import Path
import bz2
import hashlib
import importlib.metadata
import json
import urllib.request
import h5py
import numpy as np
import torch
import torchcrepe

OFFICIAL_COMMIT = "bb29b8d99a89924476d112d27ed470e4ac5617c0"
PORT_COMMIT = "19e2ec3d494c0797a5ff2a11408ec5838fba6681"
MODELS = {
    "tiny": {"compressed": "9c1d76d405674d2327f5636347d07f551dfd11c6acc0475b7fd85082cdab0add", "h5": "409254d6a537cc432061112b7ec5f6fd283658f108fc2abc24db9c25858b42df", "pth": "d4993eea36ed1a0ad9ac549c740dae5265b049ce72004f00c2f59e01c0be8432"},
    "full": {"compressed": "b27a576b96aea1545f10ca2aded114f0fbd6df8dcebb669236fb59f6065f01d8", "h5": "b6fd2758b03a8625a16fe86cd474ff0d8f30ad9a05e4bee2244e13e98664f860", "pth": "133225604dedd2e4005f8bbd1bd0a2ec073ba8b7a6cd31ff6d5edbbfa3539986"},
}
ROOT = Path("work/crepe/provenance")
def sha(data):
    return hashlib.sha256(data).hexdigest()
def download(url, path):
    if not path.exists():
        with urllib.request.urlopen(url, timeout=90) as response:
            path.write_bytes(response.read())
    return path.read_bytes()
def verify(capacity):
    ROOT.mkdir(parents=True, exist_ok=True)
    if importlib.metadata.version("torchcrepe") != "0.0.24":
        raise ValueError("Expected pinned torchcrepe 0.0.24")
    expected = MODELS[capacity]
    url = f"https://raw.githubusercontent.com/marl/crepe/{OFFICIAL_COMMIT}/model-{capacity}.h5.bz2"
    compressed = download(url, ROOT / f"model-{capacity}.h5.bz2")
    assert sha(compressed) == expected["compressed"], "Official compressed model hash mismatch"
    raw = bz2.decompress(compressed)
    assert sha(raw) == expected["h5"], "Official H5 model hash mismatch"
    h5_path = ROOT / f"model-{capacity}.h5"
    if not h5_path.exists():
        h5_path.write_bytes(raw)
    assert sha(h5_path.read_bytes()) == expected["h5"]
    pth = Path(torchcrepe.__file__).parent / "assets" / f"{capacity}.pth"
    assert sha(pth.read_bytes()) == expected["pth"], "Installed PyTorch weights hash mismatch"
    state = torch.load(pth, map_location="cpu", weights_only=True)
    matched = []
    with h5py.File(h5_path, "r") as h5:
        for key, tensor in state.items():
            layer, name = key.rsplit(".", 1)
            if name == "num_batches_tracked":
                assert tensor.item() == 0
                continue
            bn = layer.endswith("_BN")
            h5_layer = layer.replace("_BN", "-BN")
            h5_name = ({"weight":"gamma", "bias":"beta", "running_mean":"moving_mean", "running_var":"moving_variance"} if bn else {"weight":"kernel", "bias":"bias"})[name] + ":0"
            arrays = []
            def find(path, obj):
                if isinstance(obj, h5py.Dataset) and path.split("/")[-1] == h5_name:
                    arrays.append(obj[:])
            h5[h5_layer].visititems(find)
            assert len(arrays) == 1, key
            array = arrays[0]
            if name == "weight" and not bn:
                array = array.T if layer == "classifier" else array.transpose(3, 2, 0, 1)
            assert np.array_equal(array, tensor.numpy()), f"Tensor differs from official CREPE: {key}"
            matched.append(key)
    # Upstream original-TensorFlow reference activations validate the port's forward pass.
    fixtures = {}
    for name in ["frames-crepe.npy", f"activation-{capacity}.npy"]:
        url_ref = f"https://raw.githubusercontent.com/maxrmorrison/torchcrepe/{PORT_COMMIT}/tests/assets/{name}"
        data = download(url_ref, ROOT / name)
        fixtures[name] = {"url":url_ref, "sha256":sha(data)}
    torchcrepe.load.model("cpu", capacity)
    frames = torch.tensor(np.load(ROOT / "frames-crepe.npy")[:16])
    with torch.inference_mode():
        actual = torchcrepe.infer(frames, capacity).numpy()
    expected_activation = np.load(ROOT / f"activation-{capacity}.npy")[:16]
    difference = np.abs(actual - expected_activation)
    assert difference.max() < 1e-5 and difference.mean() < 1e-7
    return {"capacity":capacity, "officialWeightsCommit":OFFICIAL_COMMIT, "portCommit":PORT_COMMIT,
        "officialUrl":url, "sha256":expected, "compressedOfficialBytes":len(compressed), "officialH5Bytes":len(raw),
        "torchWeightsBytes":pth.stat().st_size, "parameters":sum(p.numel() for p in torchcrepe.infer.model.parameters()),
        "exactlyMatchingTensors":len(matched), "matchedTensorNames":matched,
        "referenceFrames":16, "referenceActivationMaxAbsoluteError":float(difference.max()), "referenceActivationMeanAbsoluteError":float(difference.mean()), "fixtures":fixtures}
if __name__ == "__main__":
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    results = [verify(c) for c in ["tiny", "full"]]
    (ROOT / "verified.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
