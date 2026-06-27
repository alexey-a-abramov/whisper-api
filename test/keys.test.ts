// SPDX-License-Identifier: AGPL-3.0-or-later
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.WHISPER_API_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "wapi-keys-"));

const { createKey, verifyKey, revokeKey, listKeys, countActiveKeys, KEY_PREFIX, hashKey } = await import("../src/keys/store");

describe("key store", () => {
  beforeAll(() => {
    // fresh home per run is set above
  });

  it("generates prefixed keys and verifies them", async () => {
    const { raw, record } = await createKey("test-key");
    expect(raw.startsWith(KEY_PREFIX)).toBe(true);
    expect(record.name).toBe("test-key");
    expect(record.prefix.startsWith(KEY_PREFIX)).toBe(true);

    const verified = await verifyKey(raw);
    expect(verified?.id).toBe(record.id);
  });

  it("stores only the hash, never the raw key", async () => {
    const { raw, record } = await createKey("hash-check");
    expect(record.hash).toBe(hashKey(raw));
    const onDisk = fs.readFileSync(path.join(process.env.WHISPER_API_HOME!, "keys.json"), "utf8");
    expect(onDisk).not.toContain(raw);
    expect(onDisk).toContain(record.hash);
  });

  it("rejects unknown and revoked keys", async () => {
    expect(await verifyKey("sk-wapi-not-a-real-key")).toBeNull();
    const { raw, record } = await createKey("to-revoke");
    expect(await verifyKey(raw)).not.toBeNull();
    const before = await countActiveKeys();
    expect(await revokeKey(record.id)).toBe(true);
    expect(await verifyKey(raw)).toBeNull();
    expect(await countActiveKeys()).toBe(before - 1);
  });

  it("updates lastUsedAt on successful verify", async () => {
    const { raw, record } = await createKey("touch");
    expect(record.lastUsedAt).toBeNull();
    await verifyKey(raw);
    const updated = (await listKeys()).find((k) => k.id === record.id);
    expect(updated?.lastUsedAt).not.toBeNull();
  });
});
