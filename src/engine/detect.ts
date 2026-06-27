// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EngineChoice } from "../config";
import type { ModelInfo } from "../models/registry";
import { OnnxEngine } from "./onnx";
import { WhisperCppEngine } from "./whispercpp";
import { buildWhisperCpp, detectGpu, hasBuildTools, locateWhisperBinary } from "./probe";
import type { TranscriptionEngine } from "./types";

export interface EngineSelection {
  engine: TranscriptionEngine;
  reason: string;
}

export interface CreateEngineOpts {
  engine: EngineChoice;
  model: ModelInfo;
  /** Permit building whisper.cpp from source if no binary is found. */
  allowBuild?: boolean;
  onLog?: (line: string) => void;
}

/**
 * Resolve which transcription engine to use.
 *
 * - `onnx`       → always the portable ONNX engine.
 * - `whispercpp` → require/obtain a native binary (build if allowed), else error.
 * - `auto`       → prefer an existing whisper.cpp binary; optionally build one;
 *                  otherwise fall back to the portable ONNX engine.
 */
export async function createEngine(opts: CreateEngineOpts): Promise<EngineSelection> {
  const { engine, model, model: m } = opts;
  const allowBuild = opts.allowBuild ?? process.env.WHISPER_API_AUTOBUILD === "1";

  if (engine === "onnx") {
    return { engine: new OnnxEngine(m), reason: "engine=onnx (portable, no compiler)" };
  }

  if (engine === "whispercpp") {
    const bin = locateWhisperBinary() ?? (await tryBuild(opts.onLog));
    if (!bin) {
      throw new Error(
        "engine=whispercpp requested but no binary is available and it could not be built. " +
          "Install build tools (git, cmake, a C/C++ compiler) and run `whisper-api build-engine`, " +
          "set WHISPER_CPP_BIN, or use --engine onnx.",
      );
    }
    return { engine: new WhisperCppEngine(model, bin, detectGpu()), reason: "engine=whispercpp" };
  }

  // auto
  const existing = locateWhisperBinary();
  if (existing) {
    return { engine: new WhisperCppEngine(model, existing, detectGpu()), reason: "auto → whisper.cpp (binary found)" };
  }
  if (allowBuild && hasBuildTools()) {
    const built = await tryBuild(opts.onLog);
    if (built) {
      return { engine: new WhisperCppEngine(model, built, detectGpu()), reason: "auto → whisper.cpp (built from source)" };
    }
  }
  return {
    engine: new OnnxEngine(m),
    reason: hasBuildTools()
      ? "auto → onnx (no whisper.cpp binary; run `whisper-api build-engine` for native speed)"
      : "auto → onnx (no whisper.cpp binary and no build toolchain)",
  };
}

async function tryBuild(onLog?: (l: string) => void): Promise<string | null> {
  try {
    return await buildWhisperCpp(onLog);
  } catch (err) {
    onLog?.(`whisper.cpp build failed: ${(err as Error).message}`);
    return null;
  }
}
