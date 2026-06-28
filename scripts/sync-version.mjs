// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerates src/version.ts from package.json. Run automatically by the npm
// "version" lifecycle (npm version patch|minor|major) so the two never drift.
import { readFileSync, writeFileSync } from "node:fs";

const pkgUrl = new URL("../package.json", import.meta.url);
const outUrl = new URL("../src/version.ts", import.meta.url);
const { version } = JSON.parse(readFileSync(pkgUrl, "utf8"));

writeFileSync(
  outUrl,
  `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated from package.json by scripts/sync-version.mjs (npm "version"). Do not edit by hand.
export const VERSION = "${version}";
`,
);
console.log(`synced src/version.ts → ${version}`);
