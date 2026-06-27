// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance } from "fastify";
import { MODELS } from "../../models/registry";
import type { ServerContext } from "../app";

/** OpenAI-compatible model listing. Advertises `whisper-1` plus all known models. */
export function registerModels(app: FastifyInstance, ctx: ServerContext): void {
  const created = 1700000000; // stable placeholder timestamp
  const entry = (id: string) => ({ id, object: "model", created, owned_by: "whisper-api" });

  app.get("/v1/models", async () => ({
    object: "list",
    data: [entry("whisper-1"), ...MODELS.map((m) => entry(m.name))],
  }));

  app.get("/v1/models/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (id === "whisper-1" || MODELS.some((m) => m.name === id)) {
      return entry(id);
    }
    return reply.code(404).send({ error: { message: `Model '${id}' not found.`, type: "invalid_request_error" } });
  });

  // Expose which model is actively loaded (handy for `status`).
  app.get("/v1/models/active", async () => entry(ctx.defaultEngine.model.name));
}
