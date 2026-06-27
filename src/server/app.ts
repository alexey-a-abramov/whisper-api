// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { WhisperApiConfig } from "../config";
import type { ModelInfo } from "../models/registry";
import type { TranscriptionEngine } from "../engine/types";
import { authHook, extractBearer } from "./auth";
import { errorBody } from "./formats";
import { registerTranscriptions } from "./routes/transcriptions";
import { registerModels } from "./routes/models";
import { registerHealth } from "./routes/health";

export interface ServerContext {
  config: WhisperApiConfig;
  /** Engine for the configured default model. */
  defaultEngine: TranscriptionEngine;
  /** Human label, e.g. "whisper.cpp (metal)". */
  engineLabel: string;
  version: string;
  /** Resolve (and cache) an engine for a specific model name. */
  getEngine(modelName: string): Promise<TranscriptionEngine>;
}

function findWebDir(): string | null {
  for (const rel of ["../web", "../../web", "../../../web"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

export async function buildServer(ctx: ServerContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.WHISPER_API_LOG === "silent" ? false : { level: process.env.WHISPER_API_LOG || "info" },
    bodyLimit: ctx.config.maxUploadBytes + 1024 * 1024,
  });

  await app.register(multipart, {
    limits: { fileSize: ctx.config.maxUploadBytes, files: 1, fields: 25 },
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => extractBearer(req.headers.authorization) ?? req.ip,
    errorResponseBuilder: () =>
      errorBody("Rate limit exceeded. Slow down or request a higher limit.", "rate_limit_error", "rate_limit_exceeded"),
  });

  app.addHook("onRequest", authHook);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = (err.statusCode && err.statusCode >= 400 ? err.statusCode : 500) as number;
    req.log.error({ err }, "request error");
    reply.code(status).send(errorBody(err.message || "Internal server error.", status >= 500 ? "server_error" : "invalid_request_error"));
  });

  // Routes
  registerHealth(app, ctx);
  registerModels(app, ctx);
  registerTranscriptions(app, ctx);

  // Static web status page (served at "/").
  const webDir = findWebDir();
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: "/", index: ["index.html"] });
  } else {
    app.get("/", async () => ({ name: "whisper-api", status: "ok", docs: "/health" }));
  }

  return app;
}

export async function startServer(ctx: ServerContext): Promise<{ app: FastifyInstance; url: string }> {
  const app = await buildServer(ctx);
  await app.listen({ host: ctx.config.host, port: ctx.config.port });
  const shown = ctx.config.host === "0.0.0.0" ? "localhost" : ctx.config.host;
  return { app, url: `http://${shown}:${ctx.config.port}` };
}
