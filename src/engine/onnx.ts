// SPDX-License-Identifier: AGPL-3.0-or-later
import { toFloat32 } from "../audio";
import { paths } from "../config";
import type { ModelInfo, ProgressFn } from "../models/registry";
import type { Segment, TranscribeOptions, TranscriptionEngine, TranscriptionResult } from "./types";

// transformers.js is heavy; import lazily so unrelated CLI commands stay fast.
type Pipeline = (input: Float32Array, opts: Record<string, unknown>) => Promise<OnnxOutput>;
interface OnnxChunk {
  timestamp: [number, number | null];
  text: string;
}
interface OnnxOutput {
  text: string;
  chunks?: OnnxChunk[];
}

const ISO_TO_NAME: Record<string, string> = {
  en: "english", es: "spanish", fr: "french", de: "german", it: "italian",
  pt: "portuguese", nl: "dutch", ru: "russian", zh: "chinese", ja: "japanese",
  ko: "korean", ar: "arabic", hi: "hindi", tr: "turkish", pl: "polish",
  uk: "ukrainian", sv: "swedish", cs: "czech", da: "danish", fi: "finnish",
};

/** Pure-JS engine via @huggingface/transformers (onnxruntime-node). No compiler needed. */
export class OnnxEngine implements TranscriptionEngine {
  readonly kind = "onnx" as const;
  readonly model: ModelInfo;
  private device: string;
  private pipe: Pipeline | null = null;

  constructor(model: ModelInfo) {
    this.model = model;
    this.device = process.env.WHISPER_API_ONNX_DEVICE || "cpu";
  }

  describe(): string {
    return `onnx (${this.device})`;
  }

  forModel(model: ModelInfo): TranscriptionEngine {
    return new OnnxEngine(model);
  }

  private async getPipe(onProgress?: ProgressFn): Promise<Pipeline> {
    if (this.pipe) return this.pipe;
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = paths.cache();
    env.allowLocalModels = true;

    const dtype = process.env.WHISPER_API_ONNX_DTYPE || (this.model.sizeMB > 1000 ? "q8" : "fp32");
    const pipe = (await pipeline("automatic-speech-recognition", this.model.onnxRepo, {
      device: this.device as never,
      dtype: dtype as never,
      progress_callback: onProgress
        ? (p: { status?: string; loaded?: number; total?: number }) => {
            if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
              onProgress(p.loaded, p.total);
            }
          }
        : undefined,
    })) as unknown as Pipeline;
    this.pipe = pipe;
    return pipe;
  }

  async ensureModel(onProgress?: ProgressFn): Promise<void> {
    // Instantiating the pipeline downloads & caches the ONNX weights.
    await this.getPipe(onProgress);
  }

  async transcribe(inputPath: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
    const pipe = await this.getPipe();
    const { samples, duration } = await toFloat32(inputPath);

    const runOpts: Record<string, unknown> = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (!this.model.englishOnly) {
      runOpts["task"] = opts.translate ? "translate" : "transcribe";
      if (opts.language) runOpts["language"] = ISO_TO_NAME[opts.language] ?? opts.language;
    }
    if (typeof opts.temperature === "number") runOpts["temperature"] = opts.temperature;

    const out = await pipe(samples, runOpts);
    const segments: Segment[] = (out.chunks ?? []).map((c, i) => ({
      id: i,
      start: c.timestamp[0] ?? 0,
      end: c.timestamp[1] ?? duration,
      text: c.text.trim(),
    }));

    return {
      text: (out.text ?? "").trim(),
      language: opts.language,
      duration,
      segments,
    };
  }
}
