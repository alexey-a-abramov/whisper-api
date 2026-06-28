# whisper-api

[![CI](https://github.com/alexey-a-abramov/whisper-api/actions/workflows/ci.yml/badge.svg)](https://github.com/alexey-a-abramov/whisper-api/actions/workflows/ci.yml)
[![CodeQL](https://github.com/alexey-a-abramov/whisper-api/actions/workflows/codeql.yml/badge.svg)](https://github.com/alexey-a-abramov/whisper-api/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alexey-a-abramov/whisper-api/badge)](https://scorecard.dev/viewer/?uri=github.com/alexey-a-abramov/whisper-api)
[![npm version](https://img.shields.io/npm/v/whisper-api.svg)](https://www.npmjs.com/package/whisper-api)
[![npm downloads](https://img.shields.io/npm/dm/whisper-api.svg)](https://www.npmjs.com/package/whisper-api)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/whisper-api.svg)](https://nodejs.org)

**Self-hostable, OpenAI-compatible Whisper speech-to-text endpoint you can stand up on any machine with one command.**

It speaks the exact same HTTP API as OpenAI's `POST /v1/audio/transcriptions`, so any tool, SDK, or app that talks to OpenAI Whisper can point at *your* server instead — your audio never leaves your box. Transcription runs locally via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (fast, GPU-capable) or a pure-JavaScript ONNX engine ([transformers.js](https://github.com/huggingface/transformers.js)) that needs no compiler.

```bash
npx whisper-api init     # pick models, download them, mint an API key
npx whisper-api start    # serve the OpenAI-compatible endpoint
```

---

## Features

- 🔌 **Drop-in OpenAI compatibility** — `/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/models`. Repoint any OpenAI client's `base_url` and it just works.
- 🧠 **Dual engine, auto-detected** — native **whisper.cpp** (CPU + NVIDIA CUDA / Apple Metal, up to `large-v3`) when available, transparent fallback to the portable **ONNX** engine so `npx` works on a bare VPS with no build tools.
- 🔑 **API key management** — generate, list, and revoke bearer keys. Only salted SHA-256 hashes are stored; raw keys are shown once.
- 🚦 **Per-key rate limiting** and configurable upload size limits.
- 📦 **Background model downloads** with progress, from tiny (75 MB) to large-v3 (3.1 GB).
- 🩺 **`/health` endpoint** and a minimal **web status page** at `/`.
- 🚀 **Turnkey deployment** — Dockerfile, docker-compose, systemd unit, and an nginx/Caddy TLS reverse-proxy sample.

## Requirements

- **Node.js ≥ 20**.
- That's it for the ONNX engine. For the native **whisper.cpp** engine you also need `git`, `cmake`, and a C/C++ compiler (or a prebuilt `whisper-cli` binary pointed to by `WHISPER_CPP_BIN`). FFmpeg is bundled via `ffmpeg-static` — nothing to install.

## Quick start

```bash
# 1. Interactive setup — choose engine, select & download models, create your first key
npx whisper-api init

# 2. Start the server (defaults to 0.0.0.0:8080)
npx whisper-api start

# 3. From any other machine / app:
curl http://YOUR_SERVER:8080/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-wapi-..." \
  -F file=@audio.m4a \
  -F model=whisper-1
```

### Personal use — one fixed token (no setup)

For a single-user endpoint you don't even need `init` or the keystore. Just pick a
secret and pass it inline — the server accepts it as a bearer key:

```bash
# choose your own token; clients send it as "Authorization: Bearer <token>"
npx whisper-api start --api-key "my-secret-token" --model base.en

# or via environment (e.g. systemd / Docker):
WHISPER_API_KEY="my-secret-token" npx whisper-api start
```

Then from anywhere:

```bash
curl http://YOUR_SERVER:8080/v1/audio/transcriptions \
  -H "Authorization: Bearer my-secret-token" \
  -F file=@audio.m4a -F model=whisper-1
```

The fixed token is accepted **in addition** to any keys created with
`whisper-api key generate`, so you can start simple and add managed keys later.
Auth is always required — there is no unauthenticated mode.

## Using it from a third-party app

Anything that supports the OpenAI API works — just change the base URL and key.

**Python (official `openai` SDK):**

```python
from openai import OpenAI

client = OpenAI(base_url="https://transcribe.example.com/v1", api_key="sk-wapi-...")
with open("meeting.m4a", "rb") as f:
    print(client.audio.transcriptions.create(model="whisper-1", file=f).text)
```

**Node (official `openai` SDK):**

```js
import OpenAI from "openai";
import fs from "node:fs";

const client = new OpenAI({ baseURL: "https://transcribe.example.com/v1", apiKey: "sk-wapi-..." });
const out = await client.audio.transcriptions.create({
  model: "whisper-1",
  file: fs.createReadStream("meeting.m4a"),
});
console.log(out.text);
```

**Other OpenAI-compatible apps** (Open WebUI, n8n, LibreChat, Raycast, …): set **Base URL** to `https://your-server/v1` and **API key** to a key from `whisper-api key generate`.

## CLI

| Command | Description |
| --- | --- |
| `whisper-api init` | Interactive setup: engine, models, first API key. |
| `whisper-api start [-p 8080] [--host 0.0.0.0] [-m base.en] [-e auto] [-k <token>]` | Start the API server. `-k/--api-key` sets a fixed personal key. |
| `whisper-api models list` | List available and installed models. |
| `whisper-api models pull <name>` | Download a model (e.g. `large-v3`). |
| `whisper-api models rm <name>` | Remove a downloaded GGML model. |
| `whisper-api key generate [-n name]` | Mint a new API key (shown once). |
| `whisper-api key list` | List keys with status and last use. |
| `whisper-api key revoke <id\|prefix>` | Revoke a key. |
| `whisper-api status` | Show config, installed models, and key count. |
| `whisper-api build-engine` | Build whisper.cpp from source for native speed. |

### Models

`tiny`, `base`, `small`, `medium` (and `.en` English-only variants), `large-v3-turbo`, `large-v3`. The OpenAI alias **`whisper-1`** maps to your configured default model.

## HTTP API

All `/v1/*` routes require `Authorization: Bearer <key>`. `/health` and `/` are public.

### `POST /v1/audio/transcriptions`
`multipart/form-data`:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | ✅ | Audio/video file (any format FFmpeg can read). |
| `model` | | Model name or `whisper-1`. Defaults to your configured model. |
| `language` | | ISO-639-1 hint, e.g. `en`. |
| `response_format` | | `json` (default), `verbose_json`, `text`, `srt`, `vtt`. |
| `temperature` | | Sampling temperature. |
| `prompt` | | Decoding/vocabulary hint. |

`json` → `{ "text": "..." }`. `verbose_json` adds `language`, `duration`, and `segments[]`.

### `POST /v1/audio/translations`
Same fields; transcribes **and translates to English**.

### `GET /v1/models`
OpenAI-shaped model list. ・ **`GET /health`** → `{ status, engine, model, activeKeys, uptime, version }`.

## Configuration

State lives in `~/.whisper-api/` (override with `WHISPER_API_HOME`): `config.json`, `keys.json`, `models/` (GGML), `cache/` (ONNX weights), `bin/` (built whisper.cpp). Any setting can be overridden by environment variables — see [`.env.example`](.env.example).

## Deployment

**Docker:**

```bash
docker compose up -d --build
docker compose exec whisper-api node bin/whisper-api.js key generate
curl localhost:8080/health
```

**systemd + nginx:** see [`deploy/whisper-api.service`](deploy/whisper-api.service) and [`deploy/nginx.conf`](deploy/nginx.conf) (includes a Caddy alternative). Run behind TLS; audio uploads can be large, so the samples raise `client_max_body_size` and proxy timeouts.

## Security

- Keys are random 256-bit secrets prefixed `sk-wapi-`; only their SHA-256 hashes are stored (`keys.json`, mode `600`). Compared in constant time.
- Bind to `127.0.0.1` and terminate TLS at a reverse proxy for public deployments.
- Per-key rate limiting (`WHISPER_API_RATE_MAX`, default 120/min) and a 25 MB upload cap by default.
- This repo runs **CodeQL** code scanning, **OpenSSF Scorecard**, and **Dependabot**. To report a vulnerability privately, see [`SECURITY.md`](SECURITY.md).

## Development

```bash
npm install
npm run dev -- init      # run the CLI from source via tsx
npm run typecheck
npm test
npm run build            # bundle to dist/ with tsup
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution workflow and coding conventions.

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer your users the corresponding source. See [`NOTICE`](NOTICE) for third-party attributions. "Whisper" and "OpenAI" are referenced only to describe API compatibility; this project is not affiliated with OpenAI.
