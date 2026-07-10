export const SERVICE_NAME = "ringguard";
export const VERSION = "1.0.0";

/** A single review/vouch record — the one and only input shape. */
export interface ReviewRecord {
  reviewer: string;
  subject: string;
  weight?: number;
}

export interface AuditRequest {
  records: ReviewRecord[];
  note?: string;
}

export interface ScreenRequest {
  records: ReviewRecord[];
  candidate_records: ReviewRecord[];
}

export type RiskTier = "critical" | "warning" | "none";

export interface ComponentReport {
  members: string[];
  size: number;
  internal_density: string;
  external_edges: number;
  collusion_shaped: boolean;
  severed: boolean;
  risk: RiskTier;
  reason: string;
}

export interface Certificate {
  audit_id: string;
  severed_agents: string[];
  guarantee: "size_blind";
  issued_at: string;
}

export interface AuditResponse {
  audit_id: string;
  summary: string;
  guarantee: "size_blind";
  thresholds: { ring_min_size: number; ring_min_density: number; k: number };
  components: ComponentReport[];
  severed_agents: string[];
  effective_scores: Record<string, string>;
  caveats: string[];
  certificate: Certificate;
  signature: string;
  key_id: string;
}

export interface ScreenResponse {
  newly_severed: string[];
  newly_exonerated: string[];
  verdict: "safe" | "suspicious";
  summary: string;
}

/** Internal typed error carried from validation to the HTTP layer. */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  hint: string;
}

/** Internal graph representation. Never serialized directly. */
export interface Graph {
  nodes: string[];
  adj: Map<string, Map<string, number>>;
}
