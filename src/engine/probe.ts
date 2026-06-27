// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paths, ensureDirs } from "../config";

export type Gpu = "cuda" | "metal" | null;

const WHISPER_CPP_REPO = "https://github.com/ggml-org/whisper.cpp";

/** Is an executable resolvable on PATH? */
export function which(cmd: string): boolean {
  const finder = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, [cmd], { stdio: "ignore" });
  return r.status === 0;
}

export function hasBuildTools(): boolean {
  const compiler = which("cc") || which("clang") || which("gcc") || which("c++");
  return which("git") && which("cmake") && compiler;
}

export function detectGpu(): Gpu {
  if (which("nvidia-smi")) return "cuda";
  if (process.platform === "darwin" && os.arch() === "arm64") return "metal";
  return null;
}

function binCandidates(): string[] {
  const exe = process.platform === "win32" ? ".exe" : "";
  const names = [`whisper-cli${exe}`, `main${exe}`];
  const out: string[] = [];
  if (process.env.WHISPER_CPP_BIN) out.push(process.env.WHISPER_CPP_BIN);
  for (const n of names) out.push(path.join(paths.bin(), n));
  return out;
}

/** Locate a usable whisper.cpp binary: env → cached build → PATH. */
export function locateWhisperBinary(): string | null {
  for (const c of binCandidates()) {
    if (fs.existsSync(c)) return c;
  }
  if (which("whisper-cli")) return "whisper-cli";
  return null;
}

type LogFn = (line: string) => void;

function step(cmd: string, args: string[], cwd: string, onLog?: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog?.(`$ ${cmd} ${args.join(" ")}`);
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const relay = (d: Buffer) => onLog?.(d.toString("utf8").trimEnd());
    proc.stdout.on("data", relay);
    proc.stderr.on("data", relay);
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

/**
 * Clone and build whisper.cpp, then install the `whisper-cli` binary into the
 * whisper-api bin dir. Best-effort: throws if the toolchain is missing or the
 * build fails, so callers can fall back to the ONNX engine.
 */
export async function buildWhisperCpp(onLog?: LogFn): Promise<string> {
  if (!hasBuildTools()) {
    throw new Error("Build tools missing (need git, cmake and a C/C++ compiler).");
  }
  ensureDirs();
  const srcDir = path.join(paths.cache(), "whisper.cpp-src");
  const buildDir = path.join(srcDir, "build");
  const gpu = detectGpu();

  if (!fs.existsSync(path.join(srcDir, "CMakeLists.txt"))) {
    fs.rmSync(srcDir, { recursive: true, force: true });
    await step("git", ["clone", "--depth", "1", WHISPER_CPP_REPO, srcDir], paths.cache(), onLog);
  }

  const cmakeArgs = [
    "-S", srcDir,
    "-B", buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
  ];
  if (gpu === "cuda") cmakeArgs.push("-DGGML_CUDA=ON");
  // Metal is enabled by default on Apple Silicon with shaders embedded in the binary.

  await step("cmake", cmakeArgs, srcDir, onLog);
  await step("cmake", ["--build", buildDir, "-j", String(Math.max(1, os.cpus().length)), "--config", "Release"], srcDir, onLog);

  const exe = process.platform === "win32" ? ".exe" : "";
  const built = [
    path.join(buildDir, "bin", `whisper-cli${exe}`),
    path.join(buildDir, "bin", "Release", `whisper-cli${exe}`),
  ].find((p) => fs.existsSync(p));
  if (!built) throw new Error("Build finished but whisper-cli binary was not found.");

  const dest = path.join(paths.bin(), `whisper-cli${exe}`);
  fs.copyFileSync(built, dest);
  fs.chmodSync(dest, 0o755);
  onLog?.(`Installed whisper.cpp → ${dest}`);
  return dest;
}
