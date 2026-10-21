import type { Graph, RiskTier } from "./types";
import { internalDensity, stronglyConnectedComponents } from "./graph";

/** Thresholds — surfaced verbatim in every audit response for transparency. */
export const RING_MIN_SIZE = 3;
export const RING_MIN_DENSITY = 0.8;

export interface ComponentAnalysis {
  members: string[];
  size: number;
  internalDensity: number;
  /** Incoming vouches this component receives from members of clean (non-shaped) components. */
  externalEdges: number;
  shaped: boolean;
  exonerated: boolean;
  severed: boolean;
  risk: RiskTier;
}

/**
 * Collusion shape test: a component is collusion-shaped iff
 *   (size ≥ RING_MIN_SIZE and internal density ≥ RING_MIN_DENSITY), or
 *   (size == 2 — a mutual-only vouch pair; any 2-node SCC has both directions).
 */
export function collusionShaped(size: number, density: number): boolean {
  return (size >= RING_MIN_SIZE && density >= RING_MIN_DENSITY) || size === 2;
}

/**
 * Full structural analysis, size-blind:
 *  1. SCC decomposition (deterministic ordering).
 *  2. Shape test per component.
 *  3. Exoneration: a shaped component that receives ≥1 vouch from a clean
 *     component is flagged (warning) but not severed. Its own outgoing vouches
 *     never count, so a ring cannot exonerate itself by reviewing honest
 *     agents. Shaped neighbors never exonerate each other.
 *  4. Severed = shaped ∧ not exonerated — for every component including the
 *     largest (the size-blind guarantee).
 */
export function analyzeGraph(graph: Graph): ComponentAnalysis[] {
  const components = stronglyConnectedComponents(graph);
  const componentOf = new Map<string, number>();
  components.forEach((members, i) => {
    for (const m of members) componentOf.set(m, i);
  });

  const densities = components.map((m) => internalDensity(graph, m));
  const shaped = components.map((m, i) => collusionShaped(m.length, densities[i]));

  // Count, per component, the incoming vouches from clean components. Only a
  // vouch an outsider gives corroborates; a vouch the component gives is its
  // own claim and costs a ring nothing to issue.
  const cleanEdgeCount = components.map(() => 0);
  for (const [from, targets] of graph.adj) {
    const cFrom = componentOf.get(from)!;
    if (shaped[cFrom]) continue;
    for (const to of targets.keys()) {
      const cTo = componentOf.get(to)!;
      if (cFrom !== cTo) cleanEdgeCount[cTo]++;
    }
  }

  return components.map((members, i) => {
    const isShaped = shaped[i];
    const exonerated = isShaped && cleanEdgeCount[i] >= 1;
    const severed = isShaped && !exonerated;
    return {
      members,
      size: members.length,
      internalDensity: densities[i],
      externalEdges: cleanEdgeCount[i],
      shaped: isShaped,
      exonerated,
      severed,
      risk: severed ? "critical" : isShaped ? "warning" : "none",
    };
  });
}

/** Sorted list of every agent in a severed component. */
export function severedAgents(analyses: ComponentAnalysis[]): string[] {
  const out: string[] = [];
  for (const a of analyses) {
    if (a.severed) out.push(...a.members);
  }
  return out.sort();
}
