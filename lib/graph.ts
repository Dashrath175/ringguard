import type { Graph, ReviewRecord } from "./types";

/**
 * Build a weighted directed graph from review records.
 * Duplicate reviewer→subject records are aggregated by summing weights
 * (missing weight defaults to 1). Nodes are kept sorted for determinism.
 */
export function buildGraph(records: ReviewRecord[]): Graph {
  const adj = new Map<string, Map<string, number>>();
  const nodeSet = new Set<string>();
  for (const r of records) {
    nodeSet.add(r.reviewer);
    nodeSet.add(r.subject);
    let out = adj.get(r.reviewer);
    if (!out) {
      out = new Map();
      adj.set(r.reviewer, out);
    }
    out.set(r.subject, (out.get(r.subject) ?? 0) + (r.weight ?? 1));
  }
  return { nodes: [...nodeSet].sort(), adj };
}

function neighborsOf(graph: Graph, node: string): string[] {
  const out = graph.adj.get(node);
  return out ? [...out.keys()].sort() : [];
}

/**
 * Strongly-connected components via iterative Tarjan (explicit work stack —
 * no recursion, immune to deep-graph stack overflow).
 * Components are returned with members sorted, ordered by (−size, then
 * lexicographic first member) for deterministic output.
 */
export function stronglyConnectedComponents(graph: Graph): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const components: string[][] = [];

  for (const start of graph.nodes) {
    if (index.has(start)) continue;

    index.set(start, counter);
    lowlink.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    const work: Array<{ node: string; neighbors: string[]; i: number }> = [
      { node: start, neighbors: neighborsOf(graph, start), i: 0 },
    ];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.i < frame.neighbors.length) {
        const next = frame.neighbors[frame.i++];
        if (!index.has(next)) {
          index.set(next, counter);
          lowlink.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, neighbors: neighborsOf(graph, next), i: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, index.get(next)!));
        }
      } else {
        work.pop();
        const done = frame.node;
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(done)!));
        }
        if (lowlink.get(done) === index.get(done)) {
          const members: string[] = [];
          for (;;) {
            const popped = stack.pop()!;
            onStack.delete(popped);
            members.push(popped);
            if (popped === done) break;
          }
          members.sort();
          components.push(members);
        }
      }
    }
  }

  components.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  return components;
}

/**
 * Internal density of a component: directed intra-component edges present
 * divided by n(n−1). Singletons have density 0.
 */
export function internalDensity(graph: Graph, members: string[]): number {
  const n = members.length;
  if (n < 2) return 0;
  const set = new Set(members);
  let internal = 0;
  for (const m of members) {
    const out = graph.adj.get(m);
    if (!out) continue;
    for (const target of out.keys()) {
      if (target !== m && set.has(target)) internal++;
    }
  }
  return internal / (n * (n - 1));
}
