import { describe, expect, it } from "vitest";
import auditHandler from "../api/audit";
import screenHandler from "../api/screen";
import keyHandler from "../api/key";
import healthHandler from "../api/health";
import type { HttpRequest, HttpResponse } from "../lib/http";

interface MockResponse extends HttpResponse {
  headers: Record<string, string>;
  body: string | undefined;
  json(): any;
}

function mockRes(): MockResponse {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(data?: string) {
      this.body = data;
    },
    json() {
      return JSON.parse(this.body ?? "null");
    },
  };
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}): HttpRequest {
  return { method, body, headers };
}

const ringRecords = [
  { reviewer: "ring_a", subject: "ring_b" },
  { reviewer: "ring_b", subject: "ring_a" },
  { reviewer: "ring_a", subject: "ring_c" },
  { reviewer: "ring_c", subject: "ring_a" },
  { reviewer: "ring_b", subject: "ring_c" },
  { reviewer: "ring_c", subject: "ring_b" },
];

describe("POST /v1/audit", () => {
  it("happy path returns a signed audit with CORS", () => {
    const res = mockRes();
    auditHandler(req("POST", { records: ringRecords }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    const body = res.json();
    expect(body.severed_agents).toEqual(["ring_a", "ring_b", "ring_c"]);
    expect(body.guarantee).toBe("size_blind");
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(body.effective_scores["ring_a"]).toBe("0.0000");
  });

  it("accepts a string body (raw JSON)", () => {
    const res = mockRes();
    auditHandler(req("POST", JSON.stringify({ records: ringRecords })), res);
    expect(res.statusCode).toBe(200);
  });

  it("a ring that reviews an honest agent is still severed", () => {
    const res = mockRes();
    const records = [
      { reviewer: "alice", subject: "bob" },
      { reviewer: "bob", subject: "carol" },
      { reviewer: "carol", subject: "alice" },
      ...ringRecords,
      { reviewer: "ring_a", subject: "alice" },
    ];
    auditHandler(req("POST", { records }), res);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.severed_agents).toEqual(["ring_a", "ring_b", "ring_c"]);
    const ring = body.components.find((c: any) => c.members.includes("ring_a"));
    expect(ring).toMatchObject({ external_edges: 0, severed: true, risk: "critical" });
  });

  it("INVALID_JSON for malformed body", () => {
    const res = mockRes();
    auditHandler(req("POST", "{not json"), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_JSON");
    expect(res.json().error.hint).toContain("records");
  });

  it("INVALID_INPUT for missing records", () => {
    const res = mockRes();
    auditHandler(req("POST", {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_INPUT");
  });

  it("INVALID_INPUT for empty records array", () => {
    const res = mockRes();
    auditHandler(req("POST", { records: [] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_INPUT");
  });

  it("INVALID_INPUT for a bad weight, naming the index", () => {
    const res = mockRes();
    auditHandler(req("POST", { records: [{ reviewer: "a", subject: "b", weight: -1 }] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("records[0].weight");
  });

  it("SELF_REVIEW names the offending index", () => {
    const res = mockRes();
    auditHandler(
      req("POST", { records: [{ reviewer: "a", subject: "b" }, { reviewer: "c", subject: "c" }] }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("SELF_REVIEW");
    expect(res.json().error.hint).toContain("index 1");
  });

  it("GRAPH_TOO_LARGE (413) when Content-Length exceeds 512 KB", () => {
    const res = mockRes();
    auditHandler(req("POST", { records: ringRecords }, { "content-length": String(600 * 1024) }), res);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("GRAPH_TOO_LARGE");
  });

  it("GRAPH_TOO_LARGE (413) when records exceed 20,000", () => {
    const records = Array.from({ length: 20_001 }, (_, i) => ({
      reviewer: `a${i}`,
      subject: `b${i}`,
    }));
    const res = mockRes();
    auditHandler(req("POST", { records }), res);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("GRAPH_TOO_LARGE");
  });

  it("GRAPH_TOO_LARGE (413) when distinct agents exceed 2,000", () => {
    const records = Array.from({ length: 1_001 }, (_, i) => ({
      reviewer: `a${i}`,
      subject: `b${i}`,
    }));
    const res = mockRes();
    auditHandler(req("POST", { records }), res);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toContain("2002 distinct agents");
  });

  it("METHOD_NOT_ALLOWED (405) on GET instructs the agent to POST", () => {
    const res = mockRes();
    auditHandler(req("GET"), res);
    expect(res.statusCode).toBe(405);
    expect(res.json().error.code).toBe("METHOD_NOT_ALLOWED");
    expect(res.json().error.hint).toContain("POST");
    expect(res.headers["allow"]).toContain("POST");
  });

  it("OPTIONS preflight returns 204 with CORS headers", () => {
    const res = mockRes();
    auditHandler(req("OPTIONS"), res);
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });
});

describe("POST /v1/screen", () => {
  it("flags candidates that form a ring", () => {
    const res = mockRes();
    screenHandler(
      req("POST", { records: [{ reviewer: "h0", subject: "h1" }], candidate_records: ringRecords }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe("suspicious");
    expect(body.newly_severed).toEqual(["ring_a", "ring_b", "ring_c"]);
  });

  it("allows an empty existing ledger but requires candidates", () => {
    const ok = mockRes();
    screenHandler(req("POST", { records: [], candidate_records: [{ reviewer: "a", subject: "b" }] }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verdict).toBe("safe");

    const bad = mockRes();
    screenHandler(req("POST", { records: [], candidate_records: [] }), bad);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("candidate_records");
  });

  it("enforces the combined record cap", () => {
    const half = Array.from({ length: 10_001 }, (_, i) => ({ reviewer: "a", subject: `b${i % 500}` }));
    const res = mockRes();
    screenHandler(req("POST", { records: half, candidate_records: half }), res);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("GRAPH_TOO_LARGE");
  });
});

describe("GET /v1/key", () => {
  it("returns the Ed25519 key material and canonicalization spec", () => {
    const res = mockRes();
    keyHandler(req("GET"), res);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.algorithm).toBe("Ed25519");
    expect(body.public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.public_key_pem).toContain("BEGIN PUBLIC KEY");
    expect(body.key_id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.signed_payload_spec).toContain("sorted lexicographically");
  });

  it("rejects POST", () => {
    const res = mockRes();
    keyHandler(req("POST", {}), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("GET /v1/health", () => {
  it("returns ok with service metadata", () => {
    const res = mockRes();
    healthHandler(req("GET"), res);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ringguard");
    expect(body.version).toBe("1.1.0");
    expect(new Date(body.time).getTime()).toBeGreaterThan(0);
  });
});
