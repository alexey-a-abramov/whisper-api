// SPDX-License-Identifier: AGPL-3.0-or-later
import cliProgress from "cli-progress";
import pc from "picocolors";

export { pc };

export function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** A reusable byte-progress bar for a single model download. */
export function modelProgress(label: string) {
  const bar = new cliProgress.SingleBar(
    { clearOnComplete: false, hideCursor: true, format: `  ${label} [{bar}] {percentage}% | {info}` },
    cliProgress.Presets.shades_classic,
  );
  let started = false;
  return {
    onProgress(received: number, total: number) {
      if (!started) {
        bar.start(total || 1, 0, { info: "" });
        started = true;
      }
      if (total) bar.setTotal(total);
      bar.update(received, { info: total ? `${mb(received)}/${mb(total)} MB` : `${mb(received)} MB` });
    },
    done() {
      if (started) {
        bar.update(bar.getTotal());
        bar.stop();
      } else {
        console.log(`  ${label} ${pc.green("✓")} ${pc.dim("(already present)")}`);
      }
    },
  };
}

/**
 * Print copy-paste examples showing how a third-party app connects to the
 * endpoint. When `key` is omitted, a placeholder is shown with a hint.
 */
export function printAccessExample(baseUrl: string, key?: string): void {
  const k = key ?? "sk-wapi-…";
  const note = key ? "" : pc.dim("  (generate one with: whisper-api key generate)\n");
  console.log();
  console.log(pc.bold("  Connect a third-party app to this endpoint:"));
  console.log();
  if (note) console.log(note.trimEnd());
  console.log(pc.dim("  # curl"));
  console.log(`  curl ${baseUrl}/v1/audio/transcriptions \\`);
  console.log(`    -H ${pc.cyan(`"Authorization: Bearer ${k}"`)} \\`);
  console.log(`    -F file=@audio.m4a -F model=whisper-1`);
  console.log();
  console.log(pc.dim("  # Python — official OpenAI SDK, just repoint base_url"));
  console.log(`  from openai import OpenAI`);
  console.log(`  client = OpenAI(base_url=${pc.cyan(`"${baseUrl}/v1"`)}, api_key=${pc.cyan(`"${k}"`)})`);
  console.log(`  print(client.audio.transcriptions.create(`);
  console.log(`      model="whisper-1", file=open("audio.m4a", "rb")).text)`);
  console.log();
  console.log(pc.dim("  # Node — official OpenAI SDK"));
  console.log(`  import OpenAI from "openai";`);
  console.log(`  const client = new OpenAI({ baseURL: ${pc.cyan(`"${baseUrl}/v1"`)}, apiKey: ${pc.cyan(`"${k}"`)} });`);
  console.log();
  console.log(pc.dim(`  # Any OpenAI-compatible app (Open WebUI, n8n, Raycast, LibreChat…):`));
  console.log(`  Base URL  ${pc.cyan(`${baseUrl}/v1`)}`);
  console.log(`  API key   ${pc.cyan(k)}`);
  console.log();
}

/** Reveal a freshly-minted secret once, with a copy warning. */
export function printNewKey(raw: string, name: string, id: string): void {
  console.log();
  console.log(pc.green("  ✔ New API key — store it now, it is not recoverable:"));
  console.log();
  console.log(`      ${pc.bold(pc.cyan(raw))}`);
  console.log();
  console.log(pc.dim(`      id ${id}   name ${name}`));
  console.log();
}
