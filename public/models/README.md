# Verified CREPE Tiny

`crepe-tiny-ca2c743a.onnx`: FP32, ONNX opset 17, 486,552 parameters, 1,963,212 bytes.
SHA-256: `ca2c743a77f1ca69b80f2e5ed43b14fbd5b3121ad9e0556497d487f07a1d33eb`.

Exported using `scripts/crepe/export_browser.py` from torchcrepe 0.0.24 Tiny weights, SHA-256 `d4993eea36ed1a0ad9ac549c740dae5265b049ce72004f00c2f59e01c0be8432`.
All 38 tensors matched the official CREPE Tiny H5 exactly, after layout conversion.
Official H5 SHA-256: `409254d6a537cc432061112b7ec5f6fd283658f108fc2abc24db9c25858b42df`.
Official model commit: [bb29b8d99a89924476d112d27ed470e4ac5617c0](https://github.com/marl/crepe/tree/bb29b8d99a89924476d112d27ed470e4ac5617c0).
Port/reference fixture commit: [19e2ec3d494c0797a5ff2a11408ec5838fba6681](https://github.com/maxrmorrison/torchcrepe/tree/19e2ec3d494c0797a5ff2a11408ec5838fba6681).

The benchmark verifies original TensorFlow reference activations and exported ONNX/WASM activations. See repository `docs/crepe-benchmark.md` and `docs/hybrid-crepe.md` for protocol and limitations. Build and browser load both enforce the ONNX hash. No external model fallback.

CREPE/torchcrepe MIT licences: `NOTICE`.
ONNX Runtime Web 1.22.0 MIT licence and third-party notices: `ONNXRUNTIME-LICENSE` and `ONNXRUNTIME-ThirdPartyNotices.txt`, copied verbatim from Microsoft's v1.22.0 tag. The runtime is pinned in package-lock.json and its WASM assets are copied locally during prebuild/predev.
