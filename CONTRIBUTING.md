# Contributing to whisper-api

Thanks for your interest in improving `whisper-api`! Contributions of all
sizes are welcome — bug reports, docs, new features, and engine support.

## Getting started

```bash
git clone https://github.com/alexey-a-abramov/whisper-api.git
cd whisper-api
npm install
npm run dev -- init      # run the CLI from source via tsx
```

## Before you open a PR

Run the full local check — CI runs the same three steps and must pass:

```bash
npm run typecheck        # tsc --noEmit (strict)
npm test                 # vitest
npm run build            # tsup bundle to dist/
```

## Conventions

- **Language:** TypeScript, ESM. Keep `npm run typecheck` clean (strict mode).
- **Style:** match the surrounding code; small, focused functions; meaningful
  names. SPDX header (`// SPDX-License-Identifier: AGPL-3.0-or-later`) at the top
  of new source files.
- **Tests:** add or update tests for behavioral changes. Prefer fast,
  dependency-free unit tests; the server integration test uses an injected fake
  engine so it needs no models, ffmpeg, or network.
- **Commits:** atomic (one logical change per commit) with clear messages.
- **Scope:** the package aims to stay small and dependency-light. Discuss large
  new dependencies or features in an issue first.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/cli/` | commander program + interactive setup (`@clack/prompts`) |
| `src/server/` | Fastify app, routes, auth, response formats |
| `src/engine/` | engine interface, whisper.cpp + ONNX implementations, auto-detect |
| `src/models/` | model registry + GGML downloader |
| `src/keys/` | API key generation/verification |
| `test/` | vitest suites |

## Adding a model

Add an entry to `MODELS` in [`src/models/registry.ts`](src/models/registry.ts)
with its GGML filename, ONNX repo, approximate size, and whether it is
English-only. That's all the CLI and both engines need.

## License of contributions

By contributing, you agree that your contributions are licensed under the
project's [AGPL-3.0-or-later](LICENSE) license.
