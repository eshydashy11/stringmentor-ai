// Same-origin, pinned WASM assets. No CDN or audio network service is used.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const expected =
  "ca2c743a77f1ca69b80f2e5ed43b14fbd5b3121ad9e0556497d487f07a1d33eb";
const model = readFileSync("public/models/crepe-tiny-ca2c743a.onnx");
if (createHash("sha256").update(model).digest("hex") !== expected)
  throw new Error("CREPE Tiny model integrity check failed");
const packageInfo = JSON.parse(
  readFileSync("node_modules/onnxruntime-web/package.json", "utf8"),
);
if (packageInfo.version !== "1.22.0")
  throw new Error("Revalidate before changing ONNX Runtime Web");
const destination = "public/vendor/onnxruntime-1.22.0";
mkdirSync(destination, { recursive: true });
for (const file of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort.wasm.min.mjs",
])
  copyFileSync(
    `node_modules/onnxruntime-web/dist/${file}`,
    `${destination}/${file}`,
  );
copyFileSync(
  "node_modules/onnxruntime-web/README.md",
  `${destination}/README.md`,
);
copyFileSync("public/models/ONNXRUNTIME-LICENSE", `${destination}/LICENSE`);
console.log(
  "Verified CREPE Tiny; prepared same-origin ONNX Runtime Web 1.22.0 assets.",
);
