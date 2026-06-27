// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance } from "fastify";
import { countActiveKeys } from "../../keys/store";
import type { ServerContext } from "../app";

/** Unauthenticated liveness/readiness endpoint. */
export function registerHealth(app: FastifyInstance, ctx: ServerContext): void {
  app.get("/health", async () => ({
    status: "ok",
    engine: ctx.engineLabel,
    model: ctx.defaultEngine.model.name,
    activeKeys: await countActiveKeys(),
    uptime: Math.round(process.uptime()),
    version: ctx.version,
  }));
}
