import { defineConfig } from "tsup";

// Single bundled CLI entry. Everything (server, engines, CLI) is reachable
// from src/cli/index.ts via static imports, so it all lands in one file.
// node_modules stay external (default), so native deps like onnxruntime-node
// and ffmpeg-static resolve normally at runtime.
export default defineConfig({
  entry: { "whisper-api": "src/cli/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: false,
});
