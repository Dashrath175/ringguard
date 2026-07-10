import type { ApiError } from "./types";
import { apiError, MAX_BODY_BYTES, type Validated } from "./validate";

/**
 * Minimal request/response shapes — structurally compatible with Vercel's
 * Node request/response helpers and with plain mocks in tests, keeping the
 * project at zero runtime dependencies.
 */
export interface HttpRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(data?: string): unknown;
}

export function sendJson(res: HttpResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

export function sendError(res: HttpResponse, error: ApiError): void {
  sendJson(res, error.status, {
    error: { code: error.code, message: error.message, hint: error.hint },
  });
}

/**
 * CORS + preflight + method gate. Returns false when the response has already
 * been sent (preflight answered or wrong method rejected with an instructive 405).
 */
export function requireMethod(
  req: HttpRequest,
  res: HttpResponse,
  method: "GET" | "POST",
  methodHint: string,
): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", `${method}, OPTIONS`);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (req.method !== method) {
    res.setHeader("Allow", `${method}, OPTIONS`);
    sendError(
      res,
      apiError(405, "METHOD_NOT_ALLOWED", `This endpoint only accepts ${method}.`, methodHint),
    );
    return false;
  }
  return true;
}

/** Reject oversized bodies before parsing, using the declared Content-Length. */
export function checkBodySize(req: HttpRequest): ApiError | null {
  const declared = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return apiError(
      413,
      "GRAPH_TOO_LARGE",
      `Request body is ${declared} bytes; the maximum is ${MAX_BODY_BYTES} (512 KB).`,
      `Split the graph into smaller requests of at most ${MAX_BODY_BYTES} bytes.`,
    );
  }
  return null;
}

const BODY_HINT = 'Send a JSON object body, e.g. {"records":[{"reviewer":"a","subject":"b"}]}, with Content-Type: application/json.';

/**
 * Read the JSON object body. Vercel's Node helper populates req.body (and
 * throws on malformed JSON when accessed); strings and Buffers are parsed
 * here. Every failure maps to a typed envelope — never a bare 500.
 */
export function readJsonBody(req: HttpRequest): Validated<Record<string, unknown>> {
  let body: unknown;
  try {
    body = req.body;
  } catch {
    return { ok: false, error: apiError(400, "INVALID_JSON", "Request body is not valid JSON.", BODY_HINT) };
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (body.trim() === "") {
      return { ok: false, error: apiError(400, "INVALID_INPUT", "Request body is empty.", BODY_HINT) };
    }
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, error: apiError(400, "INVALID_JSON", "Request body is not valid JSON.", BODY_HINT) };
    }
  }
  if (body === undefined || body === null) {
    return { ok: false, error: apiError(400, "INVALID_INPUT", "Request body is empty.", BODY_HINT) };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: apiError(400, "INVALID_INPUT", "Request body must be a JSON object.", BODY_HINT) };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

/** Catch-all so unexpected failures still return the typed envelope. */
export function sendInternalError(res: HttpResponse, err: unknown): void {
  console.error("[ringguard] unexpected error:", err);
  sendError(
    res,
    apiError(
      500,
      "INTERNAL",
      "RingGuard hit an unexpected error processing this request.",
      "Retry the request; if it persists, simplify the input records.",
    ),
  );
}
