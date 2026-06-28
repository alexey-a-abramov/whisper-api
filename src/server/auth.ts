// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyKey, type KeyRecord } from "../keys/store";
import { errorBody } from "./formats";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: KeyRecord;
  }
}

/** Paths that never require authentication. */
const PUBLIC_PATHS = new Set(["/health", "/", "/favicon.ico"]);

function isPublic(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return PUBLIC_PATHS.has(pathname) || (!pathname.startsWith("/v1/") && !pathname.startsWith("/v1"));
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

/** Constant-time check of a token against a set of static keys (compares hashes). */
function matchesStatic(token: string, staticKeys: string[]): boolean {
  const t = crypto.createHash("sha256").update(token).digest();
  for (const k of staticKeys) {
    if (!k) continue;
    const h = crypto.createHash("sha256").update(k).digest();
    if (h.length === t.length && crypto.timingSafeEqual(h, t)) return true;
  }
  return false;
}

export interface AuthContext {
  /** Fixed tokens accepted in addition to generated keys (personal/simple setups). */
  staticApiKeys: string[];
}

/**
 * Build a Fastify onRequest hook enforcing bearer-token auth on /v1/* routes.
 * Accepts either a configured static key (env/flag) or a generated keystore key.
 */
export function makeAuthHook(ctx: AuthContext) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isPublic(req.url)) return;

    const token = extractBearer(req.headers.authorization);
    if (!token) {
      await reply
        .code(401)
        .send(errorBody("Missing bearer token. Pass `Authorization: Bearer <key>`.", "invalid_request_error", "missing_api_key"));
      return;
    }

    if (ctx.staticApiKeys.length && matchesStatic(token, ctx.staticApiKeys)) {
      req.apiKey = {
        id: "static",
        name: "static",
        prefix: token.slice(0, 8),
        hash: "",
        createdAt: "",
        lastUsedAt: null,
        revoked: false,
      };
      return;
    }

    const record = await verifyKey(token);
    if (!record) {
      await reply.code(401).send(errorBody("Invalid or revoked API key.", "invalid_request_error", "invalid_api_key"));
      return;
    }
    req.apiKey = record;
  };
}
