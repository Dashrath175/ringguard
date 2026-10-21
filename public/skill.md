# RingGuard

Audits agent reputation graphs for collusion rings and wash-traded trust. RingGuard is **NOT a reputation store — it audits them**: send it the raw review records any reputation system holds (who vouched for whom) and it tells you, deterministically, which agents are propped up by a collusion ring, with a signed certificate you can verify offline.

**Base URL:** `https://ringguard.vercel.app`

**No authentication. No signup. No API key. Just call it.**

---

## Quickstart

One POST is all you need. Copy this exactly, then substitute your own records:

```bash
curl -s -X POST https://ringguard.vercel.app/v1/audit \
  -H "Content-Type: application/json" \
  -d '{"records":[
    {"reviewer":"alice","subject":"bob"},
    {"reviewer":"bob","subject":"carol"},
    {"reviewer":"carol","subject":"alice"},
    {"reviewer":"ring_a","subject":"ring_b"},
    {"reviewer":"ring_b","subject":"ring_a"},
    {"reviewer":"ring_a","subject":"ring_c"},
    {"reviewer":"ring_c","subject":"ring_a"},
    {"reviewer":"ring_b","subject":"ring_c"},
    {"reviewer":"ring_c","subject":"ring_b"}
  ]}'
```

Response (exact output for this input; only `certificate.issued_at` and `signature` vary per call because each certificate is freshly timestamped and signed — every other byte is deterministic):

```json
{
  "audit_id": "965d60242c4f31fb",
  "summary": "Audited 6 agents across 2 components: 1 severed as collusion ring (ring_a, ring_b, ring_c), 0 flagged as warnings, 1 clean.",
  "guarantee": "size_blind",
  "thresholds": {
    "ring_min_size": 3,
    "ring_min_density": 0.8,
    "k": 10
  },
  "components": [
    {
      "members": [
        "alice",
        "bob",
        "carol"
      ],
      "size": 3,
      "internal_density": "0.50",
      "external_edges": 0,
      "collusion_shaped": false,
      "severed": false,
      "risk": "none",
      "reason": "3-member component: internal density 0.50 < 0.80 → not collusion-shaped → clean."
    },
    {
      "members": [
        "ring_a",
        "ring_b",
        "ring_c"
      ],
      "size": 3,
      "internal_density": "1.00",
      "external_edges": 0,
      "collusion_shaped": true,
      "severed": true,
      "risk": "critical",
      "reason": "3-member component: internal density 1.00 ≥ 0.80, size ≥ 3, incoming vouches from clean outsiders: 0 → collusion-shaped and uncorroborated → severed."
    }
  ],
  "severed_agents": [
    "ring_a",
    "ring_b",
    "ring_c"
  ],
  "effective_scores": {
    "alice": "0.0952",
    "bob": "0.0952",
    "carol": "0.0952",
    "ring_a": "0.0000",
    "ring_b": "0.0000",
    "ring_c": "0.0000"
  },
  "caveats": [
    "A dense clique that no clean outsider vouches for is indistinguishable from a wash ring by structure; RingGuard severs it fail-safe rather than guessing by size.",
    "risk 'warning' means collusion-shaped but vouched for by at least one clean outsider: reported for review, never severed. A component's own outgoing vouches never count as corroboration.",
    "Structure cannot tell a fabricated outsider from a real one: a fresh identity that vouches for a ring downgrades it to 'warning'. Where identities are cheap, check who the corroborating vouchers are."
  ],
  "certificate": {
    "audit_id": "965d60242c4f31fb",
    "severed_agents": [
      "ring_a",
      "ring_b",
      "ring_c"
    ],
    "guarantee": "size_blind",
    "issued_at": "2026-07-10T12:00:00Z"
  },
  "signature": "86fe9ee537b59b19406d6acf1e7a70c23deda556a944849b565becb49cfc4d708207f77fb68ba72b11eec977157786012bda2615c3c4812574f5bb0820b4610b",
  "key_id": "7552fc4e89e51d0e"
}
```

The three mutually-vouching `ring_*` agents were detected as a collusion ring and severed; the honest `alice → bob → carol → alice` cycle (density 0.50) was left untouched.

---

## Endpoints

### `POST /v1/audit` — full collusion audit with signed certificate

- **Request body:** `{"records": [Record, ...], "note": "optional string"}`
- **Response:** the full audit shown in Quickstart — `summary`, `components[]` (each with `members`, `size`, `internal_density`, `external_edges`, `collusion_shaped`, `severed`, `risk`, `reason`), `severed_agents[]`, `effective_scores{}`, `caveats[]`, plus a `certificate` signed with Ed25519 (`signature`, `key_id`).

### `POST /v1/screen` — check reviews BEFORE accepting them

Ask "would accepting these new reviews create a collusion ring?" without committing them.

- **Request body:** `{"records": [...your existing records...], "candidate_records": [...the proposed new records...]}` — `records` may be an empty array; `candidate_records` needs at least one record. Both use the same `Record` shape.
- **Response:** `{"newly_severed": [...], "newly_exonerated": [...], "verdict": "safe" | "suspicious", "summary": "..."}` — `suspicious` means the candidates would sever someone or create a new collusion-shaped component. Advisory (unsigned).

Example:

```bash
curl -s -X POST https://ringguard.vercel.app/v1/screen \
  -H "Content-Type: application/json" \
  -d '{"records":[
    {"reviewer":"alice","subject":"bob"},
    {"reviewer":"bob","subject":"carol"},
    {"reviewer":"carol","subject":"alice"}
  ],"candidate_records":[
    {"reviewer":"ring_a","subject":"ring_b"},
    {"reviewer":"ring_b","subject":"ring_a"}
  ]}'
```

Response:

```json
{
  "newly_severed": [
    "ring_a",
    "ring_b"
  ],
  "newly_exonerated": [],
  "verdict": "suspicious",
  "summary": "Accepting the 2 candidate records would sever 2 agents and create 1 new collusion-shaped component → suspicious."
}
```

### `GET /v1/key` — Ed25519 verification key

```bash
curl -s https://ringguard.vercel.app/v1/key
```

Response:

```json
{
  "algorithm": "Ed25519",
  "key_id": "7552fc4e89e51d0e",
  "public_key_hex": "e98963058450d9c350bdc99af0ef446bf047ca63f75ca4183b26bf9c79d7ba62",
  "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA6YljBYRQ2cNQvcma8O9Ea/BHymP3XKQYOya/nHnXumI=\n-----END PUBLIC KEY-----\n",
  "signed_payload_spec": "The signature is Ed25519 over the UTF-8 bytes of the certificate object serialized as JSON with object keys sorted lexicographically at every nesting level and no whitespace (compact separators, arrays kept in order). The signature field is lowercase hex. Verify with the key from /v1/key (public_key_hex is the raw 32-byte key; public_key_pem is the same key as SPKI PEM)."
}
```

### `GET /v1/health` — liveness

```bash
curl -s https://ringguard.vercel.app/v1/health
```

Returns `{"status":"ok","service":"ringguard","version":"1.1.0","time":"<ISO-8601>"}`. Call it first if you want to confirm the service is up.

---

## Agent workflows

### Workflow A — audit a set of reviews you hold

1. Collect your review records as `{"reviewer": ..., "subject": ...}` pairs (reviewer vouches for subject).
2. `POST /v1/audit` with `{"records": [...]}`.
3. Read `severed_agents`: do not trust these agents or any vouch they issued.
4. Use `effective_scores[agent]` (string, "0.0000"–"1.0000") as the wash-resistant trust score for each agent.
5. Store the `certificate` + `signature` + `key_id` as tamper-evident proof of the audit.

### Workflow B — screen incoming reviews before accepting them

1. Hold your accepted records as `records` and the incoming batch as `candidate_records`.
2. `POST /v1/screen`.
3. If `verdict` is `"suspicious"`, reject or quarantine the batch; `newly_severed` names exactly which agents the batch would incriminate.
4. If `verdict` is `"safe"`, accept the batch.

### Workflow C — verify a certificate offline

1. `GET /v1/key` and keep `public_key_hex` (or `public_key_pem`) and `key_id`.
2. Take the `certificate` object from an audit response. Serialize it canonically: JSON with object keys sorted lexicographically at every nesting level, no whitespace, arrays in given order, UTF-8 bytes. For the Quickstart certificate the exact canonical bytes are:
   `{"audit_id":"965d60242c4f31fb","guarantee":"size_blind","issued_at":"2026-07-10T12:00:00Z","severed_agents":["ring_a","ring_b","ring_c"]}`
3. Verify the hex `signature` over those bytes with Ed25519. In Node.js:

```js
const crypto = require("node:crypto");
const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
const ok = crypto.verify(null, Buffer.from(canonical(certificate), "utf8"),
  crypto.createPublicKey(public_key_pem), Buffer.from(signature, "hex"));
// ok === true means the certificate is authentic and untampered
```

---

## Input format

There is exactly one record shape, used by every endpoint:

```json
{"reviewer": "agent-id-string", "subject": "agent-id-string", "weight": 1}
```

- `reviewer` — the agent giving the vouch/review. Non-empty string, ≤ 128 characters (unicode fine).
- `subject` — the agent being vouched for. Must differ from `reviewer`.
- `weight` — optional positive number; defaults to 1. Duplicate reviewer→subject records are summed into one weighted edge.

Caps per request: body ≤ 512 KB, ≤ 20,000 records, ≤ 2,000 distinct agents.

Worked correction — this request is malformed:

```json
{"records": [{"reviewer": "a", "subject": "a"}]}
```

It returns `400 SELF_REVIEW` with hint "Remove or fix the record at index 0; reviewer and subject must differ." Corrected:

```json
{"records": [{"reviewer": "a", "subject": "b"}]}
```

---

## Errors

Every non-200 response is `{"error": {"code", "message", "hint"}}` — the `hint` always tells you exactly what to change.

| HTTP | code                 | Meaning                                                | Fix |
|------|----------------------|--------------------------------------------------------|-----|
| 400  | `INVALID_JSON`       | Body is not parseable JSON                             | Send a valid JSON object with `Content-Type: application/json` |
| 400  | `INVALID_INPUT`      | Missing/malformed field (message names the exact one)  | Follow the hint; the record shape is `{"reviewer","subject"}` |
| 400  | `SELF_REVIEW`        | A record has `reviewer === subject`                    | Remove or fix the record at the index named in the hint |
| 413  | `GRAPH_TOO_LARGE`    | Body > 512 KB, > 20,000 records, or > 2,000 agents     | Split the graph across smaller requests |
| 405  | `METHOD_NOT_ALLOWED` | Wrong HTTP method                                      | The hint states the correct method (e.g. POST for /v1/audit) |

---

## How to read the result

- `severed: true` / `risk: "critical"` — the component is collusion-shaped (dense mutual vouching) and no clean outsider vouches for it. Treat its members as untrusted; their vouches are voided from all scores.
- `risk: "warning"` — collusion-shaped but at least one clean outsider vouches for it, so it is flagged for review, never punished. This is the false-positive valve for dense honest teams.
- `risk: "none"` — no collusion shape.
- `external_edges` — the number of incoming vouches the component receives from clean outsiders. Only these corroborate: vouches the component itself gives out never count, so a ring cannot clear itself by reviewing honest agents.
- `reason` — a per-component sentence citing the measured values (size, density, incoming vouches from clean outsiders) behind the verdict.
- `effective_scores[agent]` — wash-resistant trust in [0,1): `1 − e^(−raw/10)` where `raw` sums incoming vouch weights from non-severed reviewers only. Severed agents score `"0.0000"`.
- `summary` — one sentence you can log or show a human verbatim.

---

## Determinism & signature

Identical input records always produce identical `audit_id`, `components`, `severed_agents`, `effective_scores`, and `summary` — record order does not matter; members and components are canonically sorted; densities and scores are fixed-precision strings. The `certificate` (only: `audit_id`, `severed_agents`, `guarantee`, `issued_at`) is what gets signed, per the canonicalization spec published at `/v1/key` and shown in Workflow C. `audit_id` is a content hash of the verdict, so two audits of the same graph share the same id even across time.

---

## Caveats & guarantee

- **Guarantee — `size_blind`:** severance never depends on a component being a minority of the graph. A collusion ring larger than the honest population is severed exactly like a small one; majority rings cannot vote themselves clean.
- **Epistemic limit:** a dense clique that no clean outsider vouches for is structurally indistinguishable from a wash ring. RingGuard severs it fail-safe rather than guessing by size; genuinely honest tight teams earn back trust the moment any clean outsider vouches for them (they then appear as `warning`, not severed). Reviews the team gives out do not count.
- **Sybil limit:** RingGuard sees only the vouch graph, so it cannot tell a freshly created outsider from a real one. A ring that fabricates an outside identity to vouch for itself appears as `warning`, not severed. Where identities are cheap, inspect who vouches for each `warning` component before trusting it.

---

*The detection algorithm was contributed upstream to Nanda Town's `agent_receipts` trust plugin (issue #97), replacing its size-based anchor rule with this size-blind detector.*
