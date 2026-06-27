// SPDX-License-Identifier: AGPL-3.0-or-later
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

export type EngineChoice = "auto" | "whispercpp" | "onnx";

export interface RateLimitConfig {
  /** Max requests per window, per API key. */
  max: number;
  /** Window, e.g. "1 minute" (parsed by @fastify/rate-limit). */
  timeWindow: string;
}

export interface WhisperApiConfig {
  engine: EngineChoice;
  /** Friendly model name, e.g. "base.en". Also the default for the `whisper-1` alias. */
  defaultModel: string;
  host: string;
  port: number;
  /** Max upload size in bytes (OpenAI parity default: 25 MB). */
  maxUploadBytes: number;
  rateLimit: RateLimitConfig;
}

export const DEFAULT_CONFIG: WhisperApiConfig = {
  engine: "auto",
  defaultModel: "base.en",
  host: "0.0.0.0",
  port: 8080,
  maxUploadBytes: 25 * 1024 * 1024,
  rateLimit: { max: 120, timeWindow: "1 minute" },
};

/** Root dir for config, keys, models and caches. Overridable for tests/containers. */
export function homeDir(): string {
  return process.env.WHISPER_API_HOME || path.join(os.homedir(), ".whisper-api");
}

export const paths = {
  home: homeDir,
  config: () => path.join(homeDir(), "config.json"),
  keys: () => path.join(homeDir(), "keys.json"),
  /** GGML model files for whisper.cpp. */
  models: () => path.join(homeDir(), "models"),
  /** transformers.js / ONNX model cache. */
  cache: () => path.join(homeDir(), "cache"),
  /** Built/downloaded whisper.cpp binaries. */
  bin: () => path.join(homeDir(), "bin"),
  /** Scratch space for uploads and converted audio. */
  tmp: () => path.join(homeDir(), "tmp"),
};

export function ensureDirs(): void {
  for (const p of [homeDir(), paths.models(), paths.cache(), paths.bin(), paths.tmp()]) {
    fs.mkdirSync(p, { recursive: true });
  }
}

export function configExists(): boolean {
  return fs.existsSync(paths.config());
}

export async function loadConfig(): Promise<WhisperApiConfig> {
  try {
    const raw = await fsp.readFile(paths.config(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WhisperApiConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...(parsed.rateLimit ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg: WhisperApiConfig): Promise<void> {
  ensureDirs();
  await fsp.writeFile(paths.config(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/**
 * Apply environment-variable overrides on top of a loaded config.
 * Useful in containers/systemd where mutating config.json is awkward.
 */
export function applyEnvOverrides(cfg: WhisperApiConfig): WhisperApiConfig {
  const out = { ...cfg, rateLimit: { ...cfg.rateLimit } };
  if (process.env.WHISPER_API_PORT) out.port = Number(process.env.WHISPER_API_PORT);
  if (process.env.WHISPER_API_HOST) out.host = process.env.WHISPER_API_HOST;
  if (process.env.WHISPER_API_ENGINE) out.engine = process.env.WHISPER_API_ENGINE as EngineChoice;
  if (process.env.WHISPER_API_MODEL) out.defaultModel = process.env.WHISPER_API_MODEL;
  if (process.env.WHISPER_API_MAX_UPLOAD_MB) {
    out.maxUploadBytes = Number(process.env.WHISPER_API_MAX_UPLOAD_MB) * 1024 * 1024;
  }
  if (process.env.WHISPER_API_RATE_MAX) out.rateLimit.max = Number(process.env.WHISPER_API_RATE_MAX);
  return out;
}
