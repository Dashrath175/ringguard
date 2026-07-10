import type { ComponentAnalysis } from "./severance";

export const CAVEATS = [
  "An isolated dense clique with zero external vouches is indistinguishable from a wash ring by structure; RingGuard severs it fail-safe rather than guessing by size.",
  "risk 'warning' means collusion-shaped but externally corroborated: reported for review, never severed.",
];

export function formatDensity(density: number): string {
  return density.toFixed(2);
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** Deterministic, template-based reason built from measured values only. */
export function componentReason(a: ComponentAnalysis): string {
  const density = formatDensity(a.internalDensity);
  if (a.size === 1) {
    return "singleton component: cannot form a ring alone → clean.";
  }
  if (!a.shaped) {
    return `${a.size}-member component: internal density ${density} < 0.80 → not collusion-shaped → clean.`;
  }
  const base =
    a.size === 2
      ? "2-member component: mutual-only vouch pair"
      : `${a.size}-member component: internal density ${density} ≥ 0.80, size ≥ 3`;
  if (a.severed) {
    return `${base}, external corroborating edges: 0 → collusion-shaped and isolated → severed.`;
  }
  return `${base}, external corroborating edges: ${a.externalEdges} → collusion-shaped but externally corroborated → flagged, not severed.`;
}

/** One self-narrating sentence naming the counts. */
export function auditSummary(analyses: ComponentAnalysis[], agentCount: number): string {
  const severedComponents = analyses.filter((a) => a.severed);
  const warnings = analyses.filter((a) => a.risk === "warning").length;
  const clean = analyses.filter((a) => a.risk === "none").length;
  const severedNames = severedComponents.flatMap((a) => a.members).sort();
  const who = severedNames.length > 0 && severedNames.length <= 8 ? ` (${severedNames.join(", ")})` : "";
  return (
    `Audited ${agentCount} agent${plural(agentCount)} across ${analyses.length} ` +
    `component${plural(analyses.length)}: ${severedComponents.length} severed as collusion ` +
    `ring${plural(severedComponents.length)}${who}, ${warnings} flagged as warning${plural(warnings)}, ` +
    `${clean} clean.`
  );
}

export function screenSummary(
  candidateCount: number,
  newlySevered: string[],
  newlyExonerated: string[],
  newShapedComponents: number,
): string {
  const suspicious = newlySevered.length > 0 || newShapedComponents > 0;
  if (suspicious) {
    return (
      `Accepting the ${candidateCount} candidate record${plural(candidateCount)} would sever ` +
      `${newlySevered.length} agent${plural(newlySevered.length)} and create ${newShapedComponents} ` +
      `new collusion-shaped component${plural(newShapedComponents)} → suspicious.`
    );
  }
  const exonerationNote =
    newlyExonerated.length > 0
      ? `; it exonerates ${newlyExonerated.length} previously severed agent${plural(newlyExonerated.length)}`
      : "";
  return (
    `Accepting the ${candidateCount} candidate record${plural(candidateCount)} creates no new ` +
    `collusion-shaped component and severs no agent${exonerationNote} → safe.`
  );
}
