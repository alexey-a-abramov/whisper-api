# Security Policy

## Supported versions

`whisper-api` is pre-1.0. Security fixes are released against the latest published
version on npm. Please always run the most recent release.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **[Private vulnerability reporting](https://github.com/alexey-a-abramov/whisper-api/security/advisories/new)**
(Security → Advisories → "Report a vulnerability"), or email **alexeyabramov@gmail.com**
with the subject `whisper-api security`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) and environment.

You can expect an acknowledgement within **72 hours** and a remediation plan once
the report is triaged. We will credit reporters in the release notes unless you
prefer to remain anonymous.

## Scope & hardening notes

`whisper-api` is meant to be **self-hosted**. When exposing it publicly:

- Terminate TLS at a reverse proxy and bind the server to `127.0.0.1`.
- Treat API keys as secrets — they grant transcription access. Only SHA-256
  hashes are stored on disk (`keys.json`, mode `600`); rotate with
  `whisper-api key revoke` / `key generate`.
- Keep per-key rate limits and the upload size cap enabled.
- Uploaded audio is written to a temporary directory and deleted after
  processing; ensure that directory is on trusted storage.
