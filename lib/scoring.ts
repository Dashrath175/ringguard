import type { Graph } from "./types";

/** Saturation constant for effective trust: score = 1 − e^(−raw/K). */
export const K = 10;

/**
 * Wash-resistant effective trust scores. Per agent:
 *   raw   = Σ weights of incoming edges whose reviewer is NOT severed
 *   score = 1 − e^(−raw/K), emitted as a fixed 4-decimal string (determinism)
 * Severed agents score "0.0000" and their outgoing vouches are voided.
 * Keys follow sorted node order so serialization is byte-stable.
 */
export function effectiveScores(graph: Graph, severed: Set<string>): Record<string, string> {
  const raw = new Map<string, number>();
  for (const [reviewer, targets] of graph.adj) {
    if (severed.has(reviewer)) continue;
    for (const [subject, weight] of targets) {
      raw.set(subject, (raw.get(subject) ?? 0) + weight);
    }
  }
  const scores: Record<string, string> = {};
  for (const node of graph.nodes) {
    scores[node] = severed.has(node)
      ? "0.0000"
      : (1 - Math.exp(-(raw.get(node) ?? 0) / K)).toFixed(4);
  }
  return scores;
}
