import { describe, expect, it } from "vitest";
import type { ReviewRecord } from "../lib/types";
import { buildGraph, internalDensity, stronglyConnectedComponents } from "../lib/graph";
import { analyzeGraph, severedAgents, collusionShaped } from "../lib/severance";
import { effectiveScores } from "../lib/scoring";
import { componentReason, auditSummary } from "../lib/reasons";
import { runAudit, runScreen } from "../lib/engine";

/** Full clique: every member vouches for every other (density 1.0). */
function clique(prefix: string, n: number): ReviewRecord[] {
  const records: ReviewRecord[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) records.push({ reviewer: `${prefix}${i}`, subject: `${prefix}${j}` });
    }
  }
  return records;
}

/** One-way chain: h0→h1→…→h(n−1). Every node is its own singleton SCC. */
function chain(prefix: string, n: number): ReviewRecord[] {
  const records: ReviewRecord[] = [];
  for (let i = 0; i < n - 1; i++) {
    records.push({ reviewer: `${prefix}${i}`, subject: `${prefix}${i + 1}` });
  }
  return records;
}

function severedOf(records: ReviewRecord[]): string[] {
  return severedAgents(analyzeGraph(buildGraph(records)));
}

describe("Phase 1 severance fixtures", () => {
  it("fixture 1: majority ring (8 vs 5 honest) is severed — size-blind", () => {
    const records = [...clique("ring", 8), ...chain("h", 5)];
    const severed = severedOf(records);
    expect(severed).toEqual(["ring0", "ring1", "ring2", "ring3", "ring4", "ring5", "ring6", "ring7"]);
    for (let i = 0; i < 5; i++) expect(severed).not.toContain(`h${i}`);
  });

  it("fixture 2: ring larger than honest population (8 vs 4) is severed", () => {
    const records = [...clique("ring", 8), ...chain("h", 4)];
    const severed = severedOf(records);
    expect(severed).toHaveLength(8);
    expect(severed.every((a) => a.startsWith("ring"))).toBe(true);
  });

  it("fixture 3: two isolated cliques are both severed (fail-safe)", () => {
    const records = [...clique("a", 4), ...clique("b", 4)];
    const severed = severedOf(records);
    expect(severed).toEqual(["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3"]);
  });

  it("fixture 4: ring bridged to honest is exonerated (warning, not severed)", () => {
    const records = [
      ...clique("ring", 4),
      ...chain("h", 3),
      { reviewer: "h0", subject: "ring0" },
    ];
    const analyses = analyzeGraph(buildGraph(records));
    const ring = analyses.find((a) => a.members.includes("ring0"))!;
    expect(ring.shaped).toBe(true);
    expect(ring.exonerated).toBe(true);
    expect(ring.severed).toBe(false);
    expect(ring.risk).toBe("warning");
    expect(ring.externalEdges).toBe(1);
    expect(severedOf(records)).toEqual([]);
  });

  it("fixture 5: two bridged rings never exonerate each other — both severed", () => {
    const records = [...clique("a", 4), ...clique("b", 4), { reviewer: "a0", subject: "b0" }];
    const severed = severedOf(records);
    expect(severed).toEqual(["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3"]);
  });

  it("fixture 6: isolated mutual pair is severed", () => {
    const records = [
      { reviewer: "x", subject: "y" },
      { reviewer: "y", subject: "x" },
    ];
    expect(severedOf(records)).toEqual(["x", "y"]);
  });

  it("mutual pair with a clean external vouch is exonerated", () => {
    const records = [
      { reviewer: "x", subject: "y" },
      { reviewer: "y", subject: "x" },
      { reviewer: "outsider", subject: "x" },
    ];
    const analyses = analyzeGraph(buildGraph(records));
    const pair = analyses.find((a) => a.members.includes("x"))!;
    expect(pair.risk).toBe("warning");
    expect(severedOf(records)).toEqual([]);
  });
});

describe("corroboration counts incoming vouches only", () => {
  it("a ring cannot exonerate itself by vouching for honest agents", () => {
    const records = [
      ...clique("ring", 3),
      ...chain("h", 3),
      { reviewer: "ring0", subject: "h0" },
      { reviewer: "ring1", subject: "h1" },
      { reviewer: "ring2", subject: "h2" },
    ];
    const analyses = analyzeGraph(buildGraph(records));
    const ring = analyses.find((a) => a.members.includes("ring0"))!;
    expect(ring.externalEdges).toBe(0);
    expect(ring.exonerated).toBe(false);
    expect(ring.risk).toBe("critical");
    expect(severedOf(records)).toEqual(["ring0", "ring1", "ring2"]);
  });

  it("only the incoming side of a two-way bridge is counted", () => {
    const records = [
      ...clique("ring", 4),
      ...chain("h", 3),
      { reviewer: "h0", subject: "ring0" },
      { reviewer: "ring1", subject: "h2" },
    ];
    const ring = analyzeGraph(buildGraph(records)).find((a) => a.members.includes("ring0"))!;
    expect(ring.externalEdges).toBe(1);
    expect(ring.risk).toBe("warning");
  });

  it("a self-vouching ring's review of an honest agent is voided from scores", () => {
    const honest: ReviewRecord[] = [
      { reviewer: "alice", subject: "bob" },
      { reviewer: "bob", subject: "carol" },
      { reviewer: "carol", subject: "alice" },
    ];
    const response = runAudit([...honest, ...clique("ring", 3), { reviewer: "ring0", subject: "alice" }]);
    expect(response.severed_agents).toEqual(["ring0", "ring1", "ring2"]);
    // alice keeps only carol's vouch (raw 1); ring0's vouch would make it raw 2 → 0.1813
    expect(response.effective_scores["alice"]).toBe("0.0952");
    expect(response.effective_scores["ring0"]).toBe("0.0000");
  });
});

describe("graph mechanics", () => {
  it("SCCs are deterministic: sorted members, ordered by (−size, lexicographic)", () => {
    const records = [...clique("zz", 3), ...clique("aa", 3), { reviewer: "solo", subject: "aa0" }];
    const comps = stronglyConnectedComponents(buildGraph(records));
    expect(comps).toEqual([["aa0", "aa1", "aa2"], ["zz0", "zz1", "zz2"], ["solo"]]);
  });

  it("a 3-cycle has density 0.50 and is not collusion-shaped", () => {
    const records: ReviewRecord[] = [
      { reviewer: "a", subject: "b" },
      { reviewer: "b", subject: "c" },
      { reviewer: "c", subject: "a" },
    ];
    const graph = buildGraph(records);
    const comps = stronglyConnectedComponents(graph);
    expect(comps).toEqual([["a", "b", "c"]]);
    expect(internalDensity(graph, comps[0])).toBeCloseTo(0.5);
    expect(collusionShaped(3, 0.5)).toBe(false);
    expect(severedOf(records)).toEqual([]);
  });

  it("a 3-clique has density 1.00 and is collusion-shaped", () => {
    const graph = buildGraph(clique("r", 3));
    expect(internalDensity(graph, ["r0", "r1", "r2"])).toBe(1);
    expect(collusionShaped(3, 1)).toBe(true);
  });

  it("one-directional pair and disconnected singletons are never severed", () => {
    const records: ReviewRecord[] = [
      { reviewer: "a", subject: "b" },
      { reviewer: "c", subject: "d" },
    ];
    const analyses = analyzeGraph(buildGraph(records));
    expect(analyses.every((a) => a.risk === "none")).toBe(true);
    expect(severedOf(records)).toEqual([]);
  });

  it("duplicate records aggregate into edge weight", () => {
    const graph = buildGraph([
      { reviewer: "a", subject: "b" },
      { reviewer: "a", subject: "b" },
      { reviewer: "a", subject: "b", weight: 2.5 },
    ]);
    expect(graph.adj.get("a")!.get("b")).toBe(4.5);
  });

  it("unicode agent ids work", () => {
    const records: ReviewRecord[] = [
      { reviewer: "агент-α", subject: "エージェント" },
      { reviewer: "エージェント", subject: "агент-α" },
    ];
    expect(severedOf(records)).toEqual(["агент-α", "エージェント"].sort());
  });
});

describe("scoring", () => {
  it("severed reviewers' vouches are voided; severed agents score 0.0000", () => {
    // x↔y is a warning pair (shaped, exonerated by outsider→x). The isolated
    // ring vouches r0→x; that edge targets a shaped component, so it does not
    // exonerate the ring, and once the ring is severed the vouch is voided.
    const records = [
      ...clique("r", 3),
      { reviewer: "x", subject: "y" },
      { reviewer: "y", subject: "x" },
      { reviewer: "outsider", subject: "x" },
      { reviewer: "r0", subject: "x" },
    ];
    const graph = buildGraph(records);
    const severed = new Set(severedAgents(analyzeGraph(graph)));
    expect([...severed]).toEqual(["r0", "r1", "r2"]);
    const scores = effectiveScores(graph, severed);
    // x keeps outsider + y (raw 2 → 0.1813); r0's vouch is voided (else raw 3 → 0.2592)
    expect(scores["x"]).toBe("0.1813");
    expect(scores["r0"]).toBe("0.0000");
    expect(scores["outsider"]).toBe("0.0000"); // no incoming edges → raw 0
  });

  it("scores saturate with incoming weight: 1 − e^(−raw/10)", () => {
    const records: ReviewRecord[] = [
      { reviewer: "a", subject: "t", weight: 10 },
      { reviewer: "b", subject: "t", weight: 10 },
    ];
    const scores = effectiveScores(buildGraph(records), new Set());
    expect(scores["t"]).toBe((1 - Math.exp(-2)).toFixed(4)); // "0.8647"
  });
});

describe("reasons and summaries", () => {
  it("severed ring reason names density, size rule, and missing corroboration", () => {
    const analyses = analyzeGraph(buildGraph(clique("r", 4)));
    expect(componentReason(analyses[0])).toBe(
      "4-member component: internal density 1.00 ≥ 0.80, size ≥ 3, incoming vouches from clean outsiders: 0 → collusion-shaped and uncorroborated → severed.",
    );
  });

  it("warning reason counts the corroborating incoming vouches", () => {
    const records = [...clique("r", 4), ...chain("h", 3), { reviewer: "h0", subject: "r0" }];
    const ring = analyzeGraph(buildGraph(records)).find((a) => a.members.includes("r0"))!;
    expect(componentReason(ring)).toBe(
      "4-member component: internal density 1.00 ≥ 0.80, size ≥ 3, incoming vouches from clean outsiders: 1 → collusion-shaped but externally corroborated → flagged, not severed.",
    );
  });

  it("summary names counts and severed agents", () => {
    const records = [...clique("ring", 3), ...chain("h", 3)];
    const graph = buildGraph(records);
    const analyses = analyzeGraph(graph);
    expect(auditSummary(analyses, graph.nodes.length)).toBe(
      "Audited 6 agents across 4 components: 1 severed as collusion ring (ring0, ring1, ring2), 0 flagged as warnings, 3 clean.",
    );
  });
});

describe("screen diffing", () => {
  it("candidates that form a new isolated ring are suspicious", () => {
    const existing = chain("h", 4);
    const result = runScreen(existing, clique("ring", 3));
    expect(result.verdict).toBe("suspicious");
    expect(result.newly_severed).toEqual(["ring0", "ring1", "ring2"]);
    expect(result.newly_exonerated).toEqual([]);
  });

  it("benign candidates are safe", () => {
    const result = runScreen(chain("h", 4), [{ reviewer: "h3", subject: "newcomer" }]);
    expect(result.verdict).toBe("safe");
    expect(result.newly_severed).toEqual([]);
  });

  it("candidates that bridge a severed ring to honest agents exonerate it", () => {
    const existing = [...clique("ring", 3), ...chain("h", 3)];
    const result = runScreen(existing, [{ reviewer: "h0", subject: "ring0" }]);
    expect(result.newly_exonerated).toEqual(["ring0", "ring1", "ring2"]);
    expect(result.newly_severed).toEqual([]);
    expect(result.verdict).toBe("safe");
  });

  it("a severed ring reviewing an honest agent does not exonerate itself", () => {
    const existing = [...clique("ring", 3), ...chain("h", 3)];
    const result = runScreen(existing, [{ reviewer: "ring0", subject: "h0" }]);
    expect(result.newly_exonerated).toEqual([]);
    expect(result.newly_severed).toEqual([]);
  });

  it("screening into an empty ledger works", () => {
    const result = runScreen([], clique("ring", 3));
    expect(result.verdict).toBe("suspicious");
    expect(result.newly_severed).toEqual(["ring0", "ring1", "ring2"]);
  });
});

describe("audit response shape", () => {
  it("exposes thresholds, guarantee, caveats, and per-component reports", () => {
    const response = runAudit([...clique("ring", 3), ...chain("h", 3)]);
    expect(response.guarantee).toBe("size_blind");
    expect(response.thresholds).toEqual({ ring_min_size: 3, ring_min_density: 0.8, k: 10 });
    expect(response.caveats.length).toBeGreaterThan(0);
    expect(response.severed_agents).toEqual(["ring0", "ring1", "ring2"]);
    expect(response.certificate.severed_agents).toEqual(["ring0", "ring1", "ring2"]);
    expect(response.certificate.audit_id).toBe(response.audit_id);
    expect(response.audit_id).toMatch(/^[0-9a-f]{16}$/);
    expect(response.signature).toMatch(/^[0-9a-f]{128}$/);
    const ring = response.components.find((c) => c.members.includes("ring0"))!;
    expect(ring).toMatchObject({
      size: 3,
      internal_density: "1.00",
      external_edges: 0,
      collusion_shaped: true,
      severed: true,
      risk: "critical",
    });
  });
});
