import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { Certificate } from "./types";

/** Exact canonicalization contract, published at /v1/key and in SKILL.md. */
export const SIGNED_PAYLOAD_SPEC =
  "The signature is Ed25519 over the UTF-8 bytes of the certificate object serialized as JSON with " +
  "object keys sorted lexicographically at every nesting level and no whitespace (compact separators, " +
  "arrays kept in order). The signature field is lowercase hex. Verify with the key from /v1/key " +
  "(public_key_hex is the raw 32-byte key; public_key_pem is the same key as SPKI PEM).";

/**
 * Canonical JSON: object keys sorted lexicographically at every level,
 * compact separators, arrays in order. The signed certificate contains only
 * strings and sorted string arrays, so there is no float canonicalization risk.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(record[k])).join(",") + "}";
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

interface SigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  keyId: string;
  ephemeral: boolean;
}

let cached: SigningKey | null = null;

/**
 * Load the Ed25519 signing key from RINGGUARD_PRIVATE_KEY (base64 PKCS8 DER).
 * Falls back to an ephemeral per-instance key when unset (local dev only) —
 * signatures then verify against /v1/key of the same instance but rotate on
 * every cold start.
 */
export function loadSigningKey(): SigningKey {
  if (cached) return cached;
  const b64 = process.env.RINGGUARD_PRIVATE_KEY;
  let privateKey: KeyObject;
  let ephemeral = false;
  if (b64 && b64.trim()) {
    privateKey = createPrivateKey({ key: Buffer.from(b64.trim(), "base64"), format: "der", type: "pkcs8" });
  } else {
    ({ privateKey } = generateKeyPairSync("ed25519"));
    ephemeral = true;
    console.warn("[ringguard] RINGGUARD_PRIVATE_KEY not set — using an ephemeral signing key.");
  }
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256").update(spki).digest("hex").slice(0, 16);
  cached = { privateKey, publicKey, keyId, ephemeral };
  return cached;
}

/** Test hook: force the next loadSigningKey() to re-read the environment. */
export function resetSigningKeyCache(): void {
  cached = null;
}

/** Raw 32-byte Ed25519 public key, lowercase hex (last 32 bytes of the SPKI DER). */
export function publicKeyHex(): string {
  const spki = loadSigningKey().publicKey.export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("hex");
}

export function publicKeyPem(): string {
  return loadSigningKey().publicKey.export({ format: "pem", type: "spki" }).toString();
}

export function signCertificate(certificate: Certificate): { signature: string; key_id: string } {
  const { privateKey, keyId } = loadSigningKey();
  const payload = Buffer.from(canonicalJson(certificate), "utf8");
  return { signature: sign(null, payload, privateKey).toString("hex"), key_id: keyId };
}
