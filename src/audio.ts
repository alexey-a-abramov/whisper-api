// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import { paths, ensureDirs } from "./config";

const SAMPLE_RATE = 16000;

function ffmpegBin(): string {
  // ffmpeg-static exports the bundled binary path; allow override.
  return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string) || "ffmpeg";
}

function run(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(err).toString("utf8").slice(-800)}`));
    });
  });
}

/** Convert any input audio/video into a 16 kHz mono 16-bit WAV file (for whisper.cpp). */
export async function toWav16k(inputPath: string): Promise<string> {
  ensureDirs();
  const outPath = path.join(paths.tmp(), `wav-${crypto.randomBytes(8).toString("hex")}.wav`);
  await run(["-nostdin", "-i", inputPath, "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", outPath, "-y"]);
  return outPath;
}

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/** Decode any input into mono 16 kHz Float32 PCM samples (for the ONNX engine). */
export async function toFloat32(inputPath: string): Promise<DecodedAudio> {
  const raw = await run(["-nostdin", "-i", inputPath, "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"]);
  // Copy into a correctly-aligned buffer before viewing as Float32.
  const aligned = new Uint8Array(raw.byteLength);
  aligned.set(raw);
  const samples = new Float32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));
  return { samples, sampleRate: SAMPLE_RATE, duration: samples.length / SAMPLE_RATE };
}

export function cleanup(file: string | undefined): void {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
