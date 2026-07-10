import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import type { ReviewRecord } from "../lib/types";
import { runAudit } from "../lib/engine";
import { canonicalJson, loadSigningKey, publicKeyHex, publicKeyPem, resetSigningKeyCache } from "../lib/certificate";

const FIXED_NOW = new Date("2026-07-10T12:00:00.000Z");

const records: ReviewRecord[] = [
  { reviewer: "alice", subject: "bob" },
  { reviewer: "bob", subject: "carol" },
  { reviewer: "carol", subject: "alice" },
  { reviewer: "ring_a", subject: "ring_b" },
  { reviewer: "ring_b", subject: "ring_a" },
  { reviewer: "ring_a", subject: "ring_c" },
  { reviewer: "ring_c", subject: "ring_a" },
  { reviewer: "ring_b", subject: "ring_c" },
  { reviewer: "ring_c", subject: "ring_b" },
];

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env.RINGGUARD_PRIVATE_KEY = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  resetSigningKeyCache();
});

describe("determinism", () => {
  it("same input twice → byte-identical response and signature", () => {
    const first = runAudit(records, { now: FIXED_NOW });
    const second = runAudit(records, { now: FIXED_NOW });
    expect(JSON.stringify(second, null, 2)).toBe(JSON.stringify(first, null, 2));
    expect(second.signature).toBe(first.signature);
  });

  it("record order does not change the verdict, ids, or scores", () => {
    const shuffled = [...records].reverse();
    const a = runAudit(records, { now: FIXED_NOW });
    const b = runAudit(shuffled, { now: FIXED_NOW });
    expect(b.audit_id).toBe(a.audit_id);
    expect(b.severed_agents).toEqual(a.severed_agents);
    expect(b.effective_scores).toEqual(a.effective_scores);
    expect(b.components).toEqual(a.components);
  });

  it("issued_at is ISO-8601 at second precision", () => {
    const response = runAudit(records, { now: FIXED_NOW });
    expect(response.certificate.issued_at).toBe("2026-07-10T12:00:00Z");
  });
});

describe("signature verification", () => {
  it("the signature verifies against the published public key over canonical bytes", () => {
    const response = runAudit(records, { now: FIXED_NOW });
    const payload = Buffer.from(canonicalJson(response.certificate), "utf8");
    const ok = verify(null, payload, loadSigningKey().publicKey, Buffer.from(response.signature, "hex"));
    expect(ok).toBe(true);
  });

  it("a tampered certificate fails verification", () => {
    const response = runAudit(records, { now: FIXED_NOW });
    const tampered = { ...response.certificate, severed_agents: [] };
    const payload = Buffer.from(canonicalJson(tampered), "utf8");
    const ok = verify(null, payload, loadSigningKey().publicKey, Buffer.from(response.signature, "hex"));
    expect(ok).toBe(false);
  });

  it("public_key_hex is the raw 32-byte key matching the PEM", () => {
    expect(publicKeyHex()).toMatch(/^[0-9a-f]{64}$/);
    expect(publicKeyPem()).toContain("BEGIN PUBLIC KEY");
    expect(loadSigningKey().keyId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("canonical JSON", () => {
  it("sorts keys at every level and uses compact separators", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});
