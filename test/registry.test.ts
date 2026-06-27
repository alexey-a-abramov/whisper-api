// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODELS, findModel, isAlias, resolveModel } from "../src/models/registry";
import { VERSION } from "../src/version";

describe("model registry", () => {
  it("treats whisper-1 as an alias", () => {
    expect(isAlias("whisper-1")).toBe(true);
    expect(isAlias("base.en")).toBe(false);
  });

  it("resolves the alias to the configured default", () => {
    expect(resolveModel("whisper-1", "small").name).toBe("small");
    expect(resolveModel(undefined, "base.en").name).toBe("base.en");
  });

  it("resolves explicit known models", () => {
    expect(resolveModel("large-v3", "base.en").name).toBe("large-v3");
  });

  it("falls back to default for unknown models", () => {
    expect(resolveModel("does-not-exist", "base.en").name).toBe("base.en");
  });

  it("every model has a ggml file and onnx repo", () => {
    for (const m of MODELS) {
      expect(m.ggmlFile).toMatch(/^ggml-.*\.bin$/);
      expect(m.onnxRepo).toContain("whisper");
      expect(m.sizeMB).toBeGreaterThan(0);
    }
    expect(findModel("base.en")).toBeDefined();
  });

  it("VERSION matches package.json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    expect(pkg.version).toBe(VERSION);
  });
});
