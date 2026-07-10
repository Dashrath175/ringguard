# RingGuard

A public, deterministic HTTP service that audits agent reputation graphs for **collusion**. Any AI agent (or reputation service) POSTs its review records — who vouched for whom — and receives in one call: the strongly-connected components of the vouch graph, which components are collusion-shaped (dense rings, mutual-only pairs), which are **severed** and the machine-readable reason, wash-resistant effective trust scores, and an **Ed25519-signed audit certificate** verifiable offline.

RingGuard is **not a reputation store** — it is the audit layer *for* reputation stores. The detection algorithm is the size-blind detector contributed upstream to Nanda Town's `agent_receipts` trust plugin (issue #97), replacing a size-based anchor rule that inverted under majority rings.

The agent-facing interface lives at [`public/skill.md`](public/skill.md), served at `/skill.md`.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/audit` | Full collusion audit of a review graph + signed certificate |
| `POST /v1/screen` | Would accepting these new reviews create a ring? (write-path gate) |
| `GET /v1/key` | Ed25519 verification key + canonicalization spec |
| `GET /v1/health` | Liveness |
| `GET /skill.md` | The agent interface (static) |

No authentication anywhere. CORS `*`. Every error is `{"error":{"code","message","hint"}}` with a corrective hint.

## How detection works

1. Build a weighted directed vouch graph (duplicates aggregate into edge weight; self-reviews rejected).
2. Decompose into strongly-connected components (iterative Tarjan — no recursion).
3. A component is **collusion-shaped** iff size ≥ 3 with internal density ≥ 0.8, or it is a mutual-only pair.
4. A shaped component is **exonerated** iff any *clean* (non-shaped) component has an edge to/with it. Shaped neighbors never exonerate each other.
5. **Severed = shaped ∧ not exonerated — for every component including the largest** (the size-blind guarantee).
6. Effective trust per agent: `1 − e^(−raw/10)` over incoming vouch weight from non-severed reviewers, as fixed 4-decimal strings. Severed agents score `0.0000`.
7. The certificate (`audit_id`, `severed_agents`, `guarantee`, `issued_at`) is signed with Ed25519 over canonical JSON (sorted keys, compact).

Identical inputs yield byte-identical results (aside from `issued_at`/`signature`, which are freshly timestamped and signed per call).

## Local development

```bash
npm install         # dev dependencies only — the service itself has zero runtime deps
npm test            # vitest: severance fixtures, determinism + signature, API handlers
npm run typecheck   # tsc --noEmit (strict)
```

## Deployment (Vercel)

1. Generate the signing key once: `npm run generate-key`. Set the printed value as the `RINGGUARD_PRIVATE_KEY` environment variable in the Vercel project (never commit it). Without it the service signs with an ephemeral per-instance key.
2. Import the repo into Vercel — framework preset **Other**, no build step. `api/*.ts` become serverless functions; `public/` is served statically; `vercel.json` rewrites `/v1/*` to the functions.
3. Ensure **Deployment Protection is OFF** (anonymous callers must reach the API).
4. Smoke-test: `curl https://<deployment>/v1/health`, then the Quickstart in `public/skill.md`.
5. If live response bytes ever drift from the skill.md examples, regenerate them: `npm run refresh-example -- https://<deployment>`.

## Project layout

```
api/    — one file per Vercel serverless function (audit, screen, key, health)
lib/    — pure deterministic engine: graph/Tarjan, severance, scoring, reasons,
          certificate (canonical JSON + Ed25519 via node:crypto), validation, http glue
test/   — vitest: Phase 1 severance fixtures, determinism/signature, handler-level API tests
public/ — skill.md (the agent interface) and a one-page human landing page
```
