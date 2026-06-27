// SPDX-License-Identifier: AGPL-3.0-or-later
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import FormData from "form-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.WHISPER_API_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "wapi-server-"));
process.env.WHISPER_API_LOG = "silent";

const { buildServer } = await import("../src/server/app");
const { createKey } = await import("../src/keys/store");
const { findModel } = await import("../src/models/registry");
const { DEFAULT_CONFIG } = await import("../src/config");
import type { FastifyInstance } from "fastify";
import type { TranscriptionEngine } from "../src/engine/types";

const model = findModel("base.en")!;

/** Deterministic stand-in engine — no models, ffmpeg or network required. */
const fakeEngine: TranscriptionEngine = {
  kind: "onnx",
  model,
  describe: () => "fake (test)",
  ensureModel: async () => {},
  transcribe: async () => ({
    text: "the quick brown fox",
    language: "en",
    duration: 1.23,
    segments: [{ id: 0, start: 0, end: 1.23, text: "the quick brown fox" }],
  }),
  forModel: () => fakeEngine,
};

let app: FastifyInstance;
let rawKey: string;

beforeAll(async () => {
  rawKey = (await createKey("test")).raw;
  app = await buildServer({
    config: { ...DEFAULT_CONFIG },
    defaultEngine: fakeEngine,
    engineLabel: fakeEngine.describe(),
    version: "test",
    getEngine: async () => fakeEngine,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function audioForm(): FormData {
  const form = new FormData();
  form.append("file", Buffer.from("RIFF....WAVEfmt "), { filename: "clip.wav", contentType: "audio/wav" });
  form.append("model", "whisper-1");
  return form;
}

describe("server", () => {
  it("health is public and reports engine + model", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.engine).toBe("fake (test)");
    expect(body.model).toBe("base.en");
  });

  it("rejects transcription without a bearer key", async () => {
    const form = audioForm();
    const res = await app.inject({ method: "POST", url: "/v1/audio/transcriptions", headers: form.getHeaders(), payload: form });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("missing_api_key");
  });

  it("rejects an invalid key", async () => {
    const form = audioForm();
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: { ...form.getHeaders(), authorization: "Bearer sk-wapi-bogus" },
      payload: form,
    });
    expect(res.statusCode).toBe(401);
  });

  it("transcribes with a valid key", async () => {
    const form = audioForm();
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: { ...form.getHeaders(), authorization: `Bearer ${rawKey}` },
      payload: form,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: "the quick brown fox" });
  });

  it("supports verbose_json", async () => {
    const form = audioForm();
    form.append("response_format", "verbose_json");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      headers: { ...form.getHeaders(), authorization: `Bearer ${rawKey}` },
      payload: form,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.language).toBe("en");
    expect(body.segments).toHaveLength(1);
  });

  it("lists models in OpenAI shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe("list");
    expect(body.data.some((m: { id: string }) => m.id === "whisper-1")).toBe(true);
  });
});
