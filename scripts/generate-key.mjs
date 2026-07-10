// Generate the Ed25519 signing keypair for RingGuard.
// Run once, set the printed RINGGUARD_PRIVATE_KEY in Vercel project settings,
// and never commit the private key.
import { generateKeyPairSync, createHash } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8Base64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const spki = publicKey.export({ format: "der", type: "spki" });

console.log("RINGGUARD_PRIVATE_KEY (base64 PKCS8 — keep secret, set in Vercel env):");
console.log(pkcs8Base64);
console.log("");
console.log("public_key_hex:", spki.subarray(spki.length - 32).toString("hex"));
console.log("key_id:        ", createHash("sha256").update(spki).digest("hex").slice(0, 16));
