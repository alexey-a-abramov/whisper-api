// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { serialize, isResponseFormat } from "../src/server/formats";
import type { TranscriptionResult } from "../src/engine/types";

const sample: TranscriptionResult = {
  text: "Hello world. Second line.",
  language: "en",
  duration: 4.5,
  segments: [
    { id: 0, start: 0, end: 1.5, text: "Hello world." },
    { id: 1, start: 1.5, end: 4.5, text: "Second line." },
  ],
};

describe("response formats", () => {
  it("recognizes valid formats", () => {
    expect(isResponseFormat("json")).toBe(true);
    expect(isResponseFormat("verbose_json")).toBe(true);
    expect(isResponseFormat("nope")).toBe(false);
  });

  it("json returns just the text", () => {
    const { contentType, body } = serialize(sample, "json");
    expect(contentType).toContain("application/json");
    expect(JSON.parse(body)).toEqual({ text: sample.text });
  });

  it("verbose_json includes segments and language", () => {
    const parsed = JSON.parse(serialize(sample, "verbose_json").body);
    expect(parsed.language).toBe("en");
    expect(parsed.duration).toBe(4.5);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toMatchObject({ id: 0, start: 0, end: 1.5, text: "Hello world." });
  });

  it("text is plain", () => {
    const { contentType, body } = serialize(sample, "text");
    expect(contentType).toContain("text/plain");
    expect(body.trim()).toBe(sample.text);
  });

  it("srt has indexed cues with comma millis", () => {
    const body = serialize(sample, "srt").body;
    expect(body).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello world.");
    expect(body).toContain("2\n00:00:01,500 --> 00:00:04,500\nSecond line.");
  });

  it("vtt starts with WEBVTT and uses dot millis", () => {
    const body = serialize(sample, "vtt").body;
    expect(body.startsWith("WEBVTT")).toBe(true);
    expect(body).toContain("00:00:01.500 --> 00:00:04.500");
  });
});
