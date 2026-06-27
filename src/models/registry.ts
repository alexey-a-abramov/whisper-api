// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config";

export interface ModelInfo {
  /** Friendly name, e.g. "base.en". */
  name: string;
  /** GGML filename used by whisper.cpp. */
  ggmlFile: string;
  /** transformers.js / ONNX model repo id. */
  onnxRepo: string;
  /** Approximate GGML download size in MB (for UX). */
  sizeMB: number;
  englishOnly: boolean;
  description: string;
}

const HF_GGML_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function ggml(name: string): string {
  return `ggml-${name}.bin`;
}

/** Supported models, smallest → largest. */
export const MODELS: ModelInfo[] = [
  { name: "tiny.en", ggmlFile: ggml("tiny.en"), onnxRepo: "Xenova/whisper-tiny.en", sizeMB: 75, englishOnly: true, description: "Fastest, English-only" },
  { name: "tiny", ggmlFile: ggml("tiny"), onnxRepo: "Xenova/whisper-tiny", sizeMB: 75, englishOnly: false, description: "Fastest, multilingual" },
  { name: "base.en", ggmlFile: ggml("base.en"), onnxRepo: "Xenova/whisper-base.en", sizeMB: 142, englishOnly: true, description: "Good speed/quality, English-only" },
  { name: "base", ggmlFile: ggml("base"), onnxRepo: "Xenova/whisper-base", sizeMB: 142, englishOnly: false, description: "Good speed/quality, multilingual" },
  { name: "small.en", ggmlFile: ggml("small.en"), onnxRepo: "Xenova/whisper-small.en", sizeMB: 466, englishOnly: true, description: "Higher quality, English-only" },
  { name: "small", ggmlFile: ggml("small"), onnxRepo: "Xenova/whisper-small", sizeMB: 466, englishOnly: false, description: "Higher quality, multilingual" },
  { name: "medium.en", ggmlFile: ggml("medium.en"), onnxRepo: "Xenova/whisper-medium.en", sizeMB: 1500, englishOnly: true, description: "High quality, English-only" },
  { name: "medium", ggmlFile: ggml("medium"), onnxRepo: "Xenova/whisper-medium", sizeMB: 1500, englishOnly: false, description: "High quality, multilingual" },
  { name: "large-v3-turbo", ggmlFile: ggml("large-v3-turbo"), onnxRepo: "onnx-community/whisper-large-v3-turbo", sizeMB: 1600, englishOnly: false, description: "Near large-v3 quality, much faster" },
  { name: "large-v3", ggmlFile: ggml("large-v3"), onnxRepo: "onnx-community/whisper-large-v3", sizeMB: 3100, englishOnly: false, description: "Best quality, multilingual" },
];

/** OpenAI clients commonly send model="whisper-1"; alias it to the configured default. */
export const OPENAI_ALIASES = new Set(["whisper-1", "whisper-large-v3", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]);

export function isAlias(model: string): boolean {
  return OPENAI_ALIASES.has(model);
}

export function findModel(name: string): ModelInfo | undefined {
  return MODELS.find((m) => m.name === name);
}

/**
 * Resolve a requested model id (possibly an OpenAI alias) to a known model,
 * falling back to the configured default.
 */
export function resolveModel(requested: string | undefined, defaultModel: string): ModelInfo {
  if (requested && !isAlias(requested)) {
    const found = findModel(requested);
    if (found) return found;
  }
  return findModel(defaultModel) ?? MODELS.find((m) => m.name === "base.en")!;
}

export function ggmlPath(model: ModelInfo): string {
  return path.join(paths.models(), model.ggmlFile);
}

export function ggmlUrl(model: ModelInfo): string {
  return `${HF_GGML_BASE}/${model.ggmlFile}`;
}

export function isGgmlInstalled(model: ModelInfo): boolean {
  return fs.existsSync(ggmlPath(model));
}

export type ProgressFn = (received: number, total: number) => void;

/**
 * Stream a GGML model file from Hugging Face to the models dir, reporting
 * progress. Downloads to a .part file and renames on success (atomic-ish).
 */
export async function downloadGgml(model: ModelInfo, onProgress?: ProgressFn): Promise<string> {
  const dest = ggmlPath(model);
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(paths.models(), { recursive: true });

  const url = ggmlUrl(model);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${model.name} (${res.status} ${res.statusText}) from ${url}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  const tmp = dest + ".part";
  const out = fs.createWriteStream(tmp);
  let received = 0;

  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (!out.write(value)) {
          await new Promise<void>((resolve) => out.once("drain", resolve));
        }
        onProgress?.(received, total);
      }
    }
  } finally {
    out.end();
    await new Promise<void>((resolve, reject) => {
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
  }
  fs.renameSync(tmp, dest);
  return dest;
}
