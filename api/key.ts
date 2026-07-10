import { loadSigningKey, publicKeyHex, publicKeyPem, SIGNED_PAYLOAD_SPEC } from "../lib/certificate";
import { requireMethod, sendInternalError, sendJson, type HttpRequest, type HttpResponse } from "../lib/http";

export default function handler(req: HttpRequest, res: HttpResponse): void {
  try {
    if (!requireMethod(req, res, "GET", "GET this endpoint (no body) to fetch the Ed25519 verification key.")) {
      return;
    }
    sendJson(res, 200, {
      algorithm: "Ed25519",
      key_id: loadSigningKey().keyId,
      public_key_hex: publicKeyHex(),
      public_key_pem: publicKeyPem(),
      signed_payload_spec: SIGNED_PAYLOAD_SPEC,
    });
  } catch (err) {
    sendInternalError(res, err);
  }
}
