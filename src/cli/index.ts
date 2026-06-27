// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Command } from "commander";
import { intro, outro, select, multiselect, isCancel, cancel, note } from "@clack/prompts";
import {
  DEFAULT_CONFIG,
  applyEnvOverrides,
  ensureDirs,
  homeDir,
  loadConfig,
  paths,
  saveConfig,
  type EngineChoice,
  type WhisperApiConfig,
} from "../config";
import {
  MODELS,
  downloadGgml,
  findModel,
  ggmlPath,
  isGgmlInstalled,
  resolveModel,
  type ModelInfo,
} from "../models/registry";
import { countActiveKeys, createKey, listKeys, revokeKey } from "../keys/store";
import { createEngine } from "../engine/detect";
import { OnnxEngine } from "../engine/onnx";
import { buildWhisperCpp, locateWhisperBinary } from "../engine/probe";
import type { TranscriptionEngine } from "../engine/types";
import { startServer, type ServerContext } from "../server/app";
import { VERSION } from "../version";
import { modelProgress, pc, printAccessExample, printNewKey } from "./ui";

// Load env from CWD and from the whisper-api home dir (quiet: no promo banners).
dotenv.config({ quiet: true });
dotenv.config({ path: path.join(homeDir(), ".env"), quiet: true });

/** Download (whisper.cpp GGML) or warm (ONNX weights) a model's assets. */
async function provision(engineChoice: EngineChoice, model: ModelInfo, label: string): Promise<void> {
  const ui = modelProgress(label.padEnd(16));
  try {
    if (engineChoice === "onnx") {
      await new OnnxEngine(model).ensureModel(ui.onProgress);
    } else {
      await downloadGgml(model, ui.onProgress);
    }
  } finally {
    ui.done();
  }
}

async function runInit(): Promise<void> {
  ensureDirs();
  const existing = await loadConfig();
  intro(pc.bold(" whisper-api setup "));

  const engine = await select({
    message: "Transcription engine",
    initialValue: existing.engine,
    options: [
      { value: "auto", label: "auto", hint: "whisper.cpp if available, else portable ONNX" },
      { value: "whispercpp", label: "whisper.cpp", hint: "fastest, GPU; needs build tools or a prebuilt binary" },
      { value: "onnx", label: "onnx", hint: "pure-JS, no compiler, runs anywhere" },
    ],
  });
  if (isCancel(engine)) return cancel("Setup cancelled.");

  const chosen = await multiselect({
    message: "Models to download (space to toggle)",
    required: true,
    initialValues: [existing.defaultModel],
    options: MODELS.map((m) => ({ value: m.name, label: `${m.name}  ${pc.dim(`(${m.sizeMB} MB)`)}`, hint: m.description })),
  });
  if (isCancel(chosen)) return cancel("Setup cancelled.");
  const selected = chosen as string[];

  let defaultModel = selected[0]!;
  if (selected.length > 1) {
    const d = await select({
      message: "Default model (served for the `whisper-1` alias)",
      initialValue: selected.includes(existing.defaultModel) ? existing.defaultModel : selected[0],
      options: selected.map((n) => ({ value: n, label: n })),
    });
    if (isCancel(d)) return cancel("Setup cancelled.");
    defaultModel = d as string;
  }

  const config: WhisperApiConfig = { ...DEFAULT_CONFIG, ...existing, engine: engine as EngineChoice, defaultModel };
  await saveConfig(config);

  const { raw, record } = await createKey("default");
  note(`${pc.cyan(raw)}\n${pc.dim(`id ${record.id}`)}`, "API key — copy now, shown once");

  console.log();
  console.log(pc.bold(`  Downloading ${selected.length} model(s) for ${engine === "onnx" ? "ONNX" : "whisper.cpp"}…`));
  for (const name of selected) {
    await provision(config.engine, findModel(name)!, name);
  }

  outro(pc.green("Setup complete."));
  console.log(`  Config:  ${paths.config()}`);
  console.log(`  Start:   ${pc.bold("whisper-api start")}`);
  printAccessExample(`http://localhost:${config.port}`, raw);
}

async function runStart(opts: { port?: string; host?: string; model?: string; engine?: string }): Promise<void> {
  ensureDirs();
  const config = applyEnvOverrides(await loadConfig());
  if (opts.port) config.port = Number(opts.port);
  if (opts.host) config.host = opts.host;
  if (opts.engine) config.engine = opts.engine as EngineChoice;

  const model = resolveModel(opts.model || config.defaultModel, config.defaultModel);
  const allowBuild = config.engine === "whispercpp" || process.env.WHISPER_API_AUTOBUILD === "1";

  console.log(pc.dim(`  Selecting engine (${config.engine})…`));
  const selection = await createEngine({
    engine: config.engine,
    model,
    allowBuild,
    onLog: (l) => console.log(pc.dim("  " + l)),
  });
  console.log(pc.dim(`  ${selection.reason}`));

  const ui = modelProgress(`model ${model.name}`.padEnd(16));
  try {
    await selection.engine.ensureModel(ui.onProgress);
  } finally {
    ui.done();
  }

  const cache = new Map<string, TranscriptionEngine>([[model.name, selection.engine]]);
  const getEngine = async (name: string): Promise<TranscriptionEngine> => {
    const cached = cache.get(name);
    if (cached) return cached;
    const info = findModel(name) ?? model;
    const eng = selection.engine.forModel(info);
    cache.set(name, eng);
    return eng;
  };

  const ctx: ServerContext = {
    config,
    defaultEngine: selection.engine,
    engineLabel: selection.engine.describe(),
    version: VERSION,
    getEngine,
  };
  const { url } = await startServer(ctx);

  console.log();
  console.log(
    `  ${pc.green("▶")} ${pc.bold("whisper-api")} on ${pc.cyan(url)}  ${pc.dim("·")} engine ${pc.bold(
      selection.engine.describe(),
    )} ${pc.dim("·")} model ${pc.bold(model.name)}`,
  );
  if ((await countActiveKeys()) === 0) {
    console.log(`  ${pc.yellow("!")} No API keys yet — run ${pc.bold("whisper-api key generate")}`);
  }
  printAccessExample(url);
}

async function runModelsList(): Promise<void> {
  const config = await loadConfig();
  console.log(pc.bold("  Models ") + pc.dim("(✓ = GGML present locally)"));
  for (const m of MODELS) {
    const mark = isGgmlInstalled(m) ? pc.green("✓") : pc.dim("·");
    const def = m.name === config.defaultModel ? pc.cyan("  (default)") : "";
    console.log(`  ${mark} ${m.name.padEnd(16)} ${String(m.sizeMB).padStart(5)} MB  ${pc.dim(m.description)}${def}`);
  }
}

async function runModelsPull(name: string): Promise<void> {
  const model = findModel(name);
  if (!model) {
    console.error(pc.red(`Unknown model '${name}'. Run \`whisper-api models list\`.`));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig();
  await provision(config.engine, model, name);
  console.log(pc.green(`  ✓ ${name} ready`));
}

async function runModelsRm(name: string): Promise<void> {
  const model = findModel(name);
  if (!model) {
    console.error(pc.red(`Unknown model '${name}'.`));
    process.exitCode = 1;
    return;
  }
  const p = ggmlPath(model);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    console.log(pc.green(`  ✓ removed ${model.ggmlFile}`));
  } else {
    console.log(pc.dim(`  nothing to remove for ${name} (ONNX weights live under ${paths.cache()})`));
  }
}

async function runKeyGenerate(opts: { name?: string }): Promise<void> {
  ensureDirs();
  const { raw, record } = await createKey(opts.name || "default");
  printNewKey(raw, record.name, record.id);
  const config = await loadConfig();
  printAccessExample(`http://localhost:${config.port}`, raw);
}

async function runKeyList(): Promise<void> {
  const keys = await listKeys();
  if (!keys.length) {
    console.log(pc.dim("  No keys yet. Create one: whisper-api key generate"));
    return;
  }
  for (const k of keys) {
    const state = k.revoked ? pc.red("revoked") : pc.green("active");
    console.log(
      `  ${k.prefix}…  ${state}  ${pc.dim(k.id)}  name=${k.name}  created=${k.createdAt.slice(0, 10)}  lastUsed=${
        k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : "never"
      }`,
    );
  }
}

async function runKeyRevoke(idOrPrefix: string): Promise<void> {
  const ok = await revokeKey(idOrPrefix);
  console.log(ok ? pc.green(`  ✓ revoked ${idOrPrefix}`) : pc.yellow(`  no active key matched ${idOrPrefix}`));
}

async function runStatus(): Promise<void> {
  const config = applyEnvOverrides(await loadConfig());
  const installed = MODELS.filter(isGgmlInstalled).map((m) => m.name);
  const bin = locateWhisperBinary();
  console.log(pc.bold("  whisper-api status"));
  console.log(`  home        ${homeDir()}`);
  console.log(`  engine      ${config.engine}`);
  console.log(`  default     ${config.defaultModel}`);
  console.log(`  listen      ${config.host}:${config.port}`);
  console.log(`  rate limit  ${config.rateLimit.max} / ${config.rateLimit.timeWindow} per key`);
  console.log(`  ggml models ${installed.length ? installed.join(", ") : pc.dim("(none downloaded)")}`);
  console.log(`  api keys    ${await countActiveKeys()} active`);
  console.log(`  whisper.cpp ${bin ? pc.green(bin) : pc.dim("not built (run: whisper-api build-engine)")}`);
}

async function runBuildEngine(): Promise<void> {
  console.log(pc.bold("  Building whisper.cpp from source…"));
  try {
    const bin = await buildWhisperCpp((l) => console.log(pc.dim("  " + l)));
    console.log(pc.green(`  ✓ built: ${bin}`));
  } catch (e) {
    console.error(pc.red(`  build failed: ${(e as Error).message}`));
    process.exitCode = 1;
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("whisper-api")
    .description("Self-hostable, OpenAI-compatible Whisper speech-to-text API server.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program.command("init").description("Interactive setup: choose engine, download models, create an API key").action(runInit);

  program
    .command("start")
    .description("Start the API server")
    .option("-p, --port <port>", "port to listen on")
    .option("--host <host>", "host to bind")
    .option("-m, --model <name>", "default model (overrides config)")
    .option("-e, --engine <engine>", "auto | whispercpp | onnx")
    .action(runStart);

  const models = program.command("models").description("Manage local transcription models");
  models.command("list").description("List available and installed models").action(runModelsList);
  models.command("pull <name>").description("Download a model (e.g. base.en, large-v3)").action(runModelsPull);
  models.command("rm <name>").description("Remove a downloaded GGML model").action(runModelsRm);

  const key = program.command("key").description("Manage API access keys");
  key.command("generate").description("Generate a new API key").option("-n, --name <name>", "label for the key").action(runKeyGenerate);
  key.command("list").description("List API keys").action(runKeyList);
  key.command("revoke <idOrPrefix>").description("Revoke a key by id or prefix").action(runKeyRevoke);

  program.command("status").description("Show configuration and local state").action(runStatus);
  program.command("build-engine").description("Build whisper.cpp from source for native speed").action(runBuildEngine);

  return program;
}

const program = buildProgram();
if (process.argv.slice(2).length === 0) {
  program.outputHelp();
  process.exit(0);
}
program.parseAsync(process.argv).catch((err: Error) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
