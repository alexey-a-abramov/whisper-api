// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ModelInfo, ProgressFn } from "../models/registry";

export type EngineKind = "whispercpp" | "onnx";

export interface TranscribeOptions {
  /** ISO-639-1 language hint, e.g. "en". Ignored by English-only models. */
  language?: string;
  /** Whisper "translate" task → output English. */
  translate?: boolean;
  temperature?: number;
  /** Decoding context / vocabulary hint. */
  prompt?: string;
}

export interface Segment {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments: Segment[];
}

export interface TranscriptionEngine {
  readonly kind: EngineKind;
  readonly model: ModelInfo;
  /** Human label for logs/health, e.g. "whisper.cpp (CUDA)" or "onnx (cpu)". */
  describe(): string;
  /** Ensure the active model's assets are present, downloading if needed. */
  ensureModel(onProgress?: ProgressFn): Promise<void>;
  transcribe(inputPath: string, opts: TranscribeOptions): Promise<TranscriptionResult>;
  /** Create a sibling engine of the same kind bound to a different model. */
  forModel(model: ModelInfo): TranscriptionEngine;
}
