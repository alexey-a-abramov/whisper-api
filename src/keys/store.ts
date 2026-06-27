// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { paths, ensureDirs } from "../config";

export const KEY_PREFIX = "sk-wapi-";

export interface KeyRecord {
  id: string;
  name: string;
  /** Human-recognizable leading slice of the raw key (safe to store/display). */
  prefix: string;
  /** SHA-256 hex of the raw key. The raw key itself is never stored. */
  hash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export function generateRawKey(): string {
  return KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function newId(): string {
  return "key_" + crypto.randomBytes(10).toString("hex");
}

async function load(): Promise<KeyRecord[]> {
  try {
    const raw = await fsp.readFile(paths.keys(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KeyRecord[]) : [];
  } catch {
    return [];
  }
}

async function persist(list: KeyRecord[]): Promise<void> {
  ensureDirs();
  // Restrictive perms — this file effectively holds the access list.
  await fsp.writeFile(paths.keys(), JSON.stringify(list, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(paths.keys(), 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
}

/** Create a new key. Returns the raw secret (shown once) plus its stored record. */
export async function createKey(name: string): Promise<{ raw: string; record: KeyRecord }> {
  const raw = generateRawKey();
  const record: KeyRecord = {
    id: newId(),
    name: name || "default",
    prefix: raw.slice(0, KEY_PREFIX.length + 6),
    hash: hashKey(raw),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
  };
  const list = await load();
  list.push(record);
  await persist(list);
  return { raw, record };
}

export async function listKeys(): Promise<KeyRecord[]> {
  return load();
}

export async function countActiveKeys(): Promise<number> {
  return (await load()).filter((k) => !k.revoked).length;
}

/** Revoke by id or prefix. Returns true if a matching active key was revoked. */
export async function revokeKey(idOrPrefix: string): Promise<boolean> {
  const list = await load();
  let changed = false;
  for (const rec of list) {
    if (!rec.revoked && (rec.id === idOrPrefix || rec.prefix === idOrPrefix)) {
      rec.revoked = true;
      changed = true;
    }
  }
  if (changed) await persist(list);
  return changed;
}

/**
 * Verify a raw bearer token against stored hashes using a constant-time compare.
 * Updates lastUsedAt on success. Returns the matching record or null.
 */
export async function verifyKey(raw: string): Promise<KeyRecord | null> {
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const candidate = Buffer.from(hashKey(raw), "hex");
  const list = await load();
  let match: KeyRecord | null = null;
  for (const rec of list) {
    if (rec.revoked) continue;
    const stored = Buffer.from(rec.hash, "hex");
    if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate)) {
      match = rec;
      break;
    }
  }
  if (match) {
    match.lastUsedAt = new Date().toISOString();
    await persist(list);
  }
  return match;
}
