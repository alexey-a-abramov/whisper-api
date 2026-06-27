// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "../config";
import { toWav16k, cleanup } from "../audio";
import { downloadGgml, ggmlPath, type ModelInfo, type ProgressFn } from "../models/registry";
import type { Gpu } from "./probe";
import type { Segment, TranscribeOptions, TranscriptionEngine, TranscriptionResult } from "./types";

interface WhisperCppJson {
  result?: { language?: string };
  params?: { language?: string };
  transcription?: Array<{
    timestamps?: { from?: string; to?: string };
    offsets?: { from?: number; to?: number }; // milliseconds
    text?: string;
  }>;
}

/** Engine backed by a native whisper.cpp `whisper-cli` binary (CPU + CUDA/Metal). */
export class WhisperCppEngine implements TranscriptionEngine {
  readonly kind = "whispercpp" as const;
  readonly model: ModelInfo;
  private bin: string;
  private gpu: Gpu;

  constructor(model: ModelInfo, bin: string, gpu: Gpu) {
    this.model = model;
    this.bin = bin;
    this.gpu = gpu;
  }

  describe(): string {
    return `whisper.cpp (${this.gpu ?? "cpu"})`;
  }

  forModel(model: ModelInfo): TranscriptionEngine {
    return new WhisperCppEngine(model, this.bin, this.gpu);
  }

  async ensureModel(onProgress?: ProgressFn): Promise<void> {
    await downloadGgml(this.model, onProgress);
  }

  async transcribe(inputPath: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
    await this.ensureModel();
    const wav = await toWav16k(inputPath);
    const outPrefix = path.join(paths.tmp(), `wcpp-${crypto.randomBytes(8).toString("hex")}`);
    const jsonPath = outPrefix + ".json";

    const args = [
      "-m", ggmlPath(this.model),
      "-f", wav,
      "-oj",
      "-of", outPrefix,
      "-np",
      "-t", String(Math.max(1, os.cpus().length)),
    ];
    if (this.model.englishOnly) {
      args.push("-l", "en");
    } else {
      args.push("-l", opts.language ?? "auto");
    }
    if (opts.translate) args.push("--translate");
    if (typeof opts.temperature === "number") args.push("-tp", String(opts.temperature));
    if (opts.prompt) args.push("--prompt", opts.prompt);

    try {
      await this.run(args);
      const raw = await fsp.readFile(jsonPath, "utf8");
      return this.parse(JSON.parse(raw) as WhisperCppJson, opts);
    } finally {
      cleanup(wav);
      cleanup(jsonPath);
    }
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      const err: Buffer[] = [];
      proc.stderr.on("data", (d: Buffer) => err.push(d));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`whisper-cli exited with code ${code}: ${Buffer.concat(err).toString("utf8").slice(-800)}`)),
      );
    });
  }

  private parse(data: WhisperCppJson, opts: TranscribeOptions): TranscriptionResult {
    const items = data.transcription ?? [];
    const segments: Segment[] = items.map((it, i) => ({
      id: i,
      start: (it.offsets?.from ?? 0) / 1000,
      end: (it.offsets?.to ?? 0) / 1000,
      text: (it.text ?? "").trim(),
    }));
    const last = items[items.length - 1];
    return {
      text: items.map((it) => it.text ?? "").join("").trim(),
      language: data.result?.language ?? data.params?.language ?? opts.language,
      duration: last?.offsets?.to ? last.offsets.to / 1000 : undefined,
      segments,
    };
  }
}

/** True if a GGML file for this model is already on disk. */
export function ggmlInstalled(model: ModelInfo): boolean {
  return fs.existsSync(ggmlPath(model));
}
