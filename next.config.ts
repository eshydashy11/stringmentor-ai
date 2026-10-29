import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      "/models/crepe-tiny-ca2c743a.onnx",
      "/vendor/onnxruntime-1.22.0/:path*",
    ].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    }));
  },
};
export default config;
