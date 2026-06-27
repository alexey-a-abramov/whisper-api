// SPDX-License-Identifier: AGPL-3.0-or-later
import type { TranscriptionResult } from "../engine/types";

export type ResponseFormat = "json" | "verbose_json" | "text" | "srt" | "vtt";

export const RESPONSE_FORMATS: ResponseFormat[] = ["json", "verbose_json", "text", "srt", "vtt"];

export function isResponseFormat(v: string): v is ResponseFormat {
  return (RESPONSE_FORMATS as string[]).includes(v);
}

function pad(n: number, width: number): string {
  return Math.floor(n).toString().padStart(width, "0");
}

/** Seconds → "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT). */
function timestamp(seconds: number, sep: "," | "."): string {
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
}

function toSrt(r: TranscriptionResult): string {
  return (
    r.segments
      .map((seg, i) => `${i + 1}\n${timestamp(seg.start, ",")} --> ${timestamp(seg.end, ",")}\n${seg.text}\n`)
      .join("\n") + "\n"
  );
}

function toVtt(r: TranscriptionResult): string {
  const cues = r.segments
    .map((seg) => `${timestamp(seg.start, ".")} --> ${timestamp(seg.end, ".")}\n${seg.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${cues}\n`;
}

export interface SerializedResponse {
  contentType: string;
  body: string;
}

/** Render a transcription result in the requested OpenAI-compatible format. */
export function serialize(result: TranscriptionResult, format: ResponseFormat): SerializedResponse {
  switch (format) {
    case "text":
      return { contentType: "text/plain; charset=utf-8", body: result.text + "\n" };
    case "srt":
      return { contentType: "text/plain; charset=utf-8", body: toSrt(result) };
    case "vtt":
      return { contentType: "text/vtt; charset=utf-8", body: toVtt(result) };
    case "verbose_json":
      return {
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          task: "transcribe",
          language: result.language ?? "unknown",
          duration: result.duration ?? 0,
          text: result.text,
          segments: result.segments.map((seg) => ({
            id: seg.id,
            seek: 0,
            start: seg.start,
            end: seg.end,
            text: seg.text,
            tokens: [],
            temperature: 0,
            avg_logprob: 0,
            compression_ratio: 0,
            no_speech_prob: 0,
          })),
        }),
      };
    case "json":
    default:
      return { contentType: "application/json; charset=utf-8", body: JSON.stringify({ text: result.text }) };
  }
}

/** OpenAI-shaped error body. */
export function errorBody(message: string, type = "invalid_request_error", code: string | null = null) {
  return { error: { message, type, param: null, code } };
}
