// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { paths, ensureDirs } from "../../config";
import { cleanup } from "../../audio";
import { resolveModel } from "../../models/registry";
import { errorBody, isResponseFormat, serialize, type ResponseFormat } from "../formats";
import type { ServerContext } from "../app";

interface ParsedRequest {
  filePath?: string;
  filename?: string;
  fields: Record<string, string>;
}

async function parseMultipart(req: import("fastify").FastifyRequest): Promise<ParsedRequest> {
  ensureDirs();
  const result: ParsedRequest = { fields: {} };
  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (part.fieldname === "file") {
        const ext = path.extname(part.filename || "") || ".bin";
        const dest = path.join(paths.tmp(), `up-${crypto.randomBytes(8).toString("hex")}${ext}`);
        await pipeline(part.file, fs.createWriteStream(dest));
        result.filePath = dest;
        result.filename = part.filename;
        if (part.file.truncated) {
          cleanup(dest);
          throw Object.assign(new Error("Uploaded file exceeds the configured size limit."), { statusCode: 413 });
        }
      } else {
        part.file.resume(); // drain unexpected file fields
      }
    } else {
      result.fields[part.fieldname] = String(part.value);
    }
  }
  return result;
}

export function registerTranscriptions(app: FastifyInstance, ctx: ServerContext): void {
  const handler = (translate: boolean) => async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    let parsed: ParsedRequest | undefined;
    try {
      parsed = await parseMultipart(req);
      if (!parsed.filePath) {
        return reply.code(400).send(errorBody("Missing required `file` field.", "invalid_request_error", "missing_file"));
      }

      const fmtRaw = parsed.fields["response_format"] || "json";
      if (!isResponseFormat(fmtRaw)) {
        return reply.code(400).send(errorBody(`Unsupported response_format '${fmtRaw}'.`, "invalid_request_error"));
      }
      const format = fmtRaw as ResponseFormat;

      const model = resolveModel(parsed.fields["model"], ctx.config.defaultModel);
      const temperature = parsed.fields["temperature"] !== undefined ? Number(parsed.fields["temperature"]) : undefined;
      const task = parsed.fields["task"];

      const engine = await ctx.getEngine(model.name);
      const result = await engine.transcribe(parsed.filePath, {
        language: parsed.fields["language"] || undefined,
        translate: translate || task === "translate",
        temperature: typeof temperature === "number" && !Number.isNaN(temperature) ? temperature : undefined,
        prompt: parsed.fields["prompt"] || undefined,
      });

      const { contentType, body } = serialize(result, format);
      return reply.header("content-type", contentType).send(body);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      const status = e.statusCode ?? 500;
      req.log.error({ err: e }, "transcription failed");
      return reply
        .code(status)
        .send(errorBody(e.message || "Transcription failed.", status === 413 ? "invalid_request_error" : "server_error"));
    } finally {
      cleanup(parsed?.filePath);
    }
  };

  const routeOpts = {
    config: { rateLimit: { max: ctx.config.rateLimit.max, timeWindow: ctx.config.rateLimit.timeWindow } },
  };
  app.post("/v1/audio/transcriptions", routeOpts, handler(false));
  app.post("/v1/audio/translations", routeOpts, handler(true));
}
