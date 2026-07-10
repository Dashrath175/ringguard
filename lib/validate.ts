import type { ApiError, ReviewRecord } from "./types";

export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_RECORDS = 20_000;
export const MAX_AGENTS = 2_000;
export const MAX_ID_LENGTH = 128;
export const MAX_NOTE_LENGTH = 500;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function apiError(status: number, code: string, message: string, hint: string): ApiError {
  return { status, code, message, hint };
}

const RECORD_SHAPE = '{"reviewer":"a","subject":"b"} (optional numeric "weight" > 0)';

/**
 * Validate and normalize one records array. Every failure carries a corrective
 * hint including the offending index where applicable.
 */
export function validateRecords(
  value: unknown,
  field: string,
  opts: { allowEmpty?: boolean } = {},
): Validated<ReviewRecord[]> {
  if (value === undefined) {
    return {
      ok: false,
      error: apiError(
        400,
        "INVALID_INPUT",
        `Missing "${field}".`,
        `Send a JSON object with a "${field}" array of records shaped ${RECORD_SHAPE}.`,
      ),
    };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: apiError(
        400,
        "INVALID_INPUT",
        `"${field}" must be an array.`,
        `Send "${field}" as a JSON array of records shaped ${RECORD_SHAPE}.`,
      ),
    };
  }
  if (value.length === 0 && !opts.allowEmpty) {
    return {
      ok: false,
      error: apiError(
        400,
        "INVALID_INPUT",
        `"${field}" is empty.`,
        `Include at least one record shaped ${RECORD_SHAPE}.`,
      ),
    };
  }
  if (value.length > MAX_RECORDS) {
    return {
      ok: false,
      error: apiError(
        413,
        "GRAPH_TOO_LARGE",
        `"${field}" has ${value.length} records; the maximum is ${MAX_RECORDS}.`,
        `Split the graph and send at most ${MAX_RECORDS} records per request.`,
      ),
    };
  }

  const records: ReviewRecord[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        ok: false,
        error: apiError(
          400,
          "INVALID_INPUT",
          `"${field}[${i}]" is not an object.`,
          `Each record must be shaped ${RECORD_SHAPE}.`,
        ),
      };
    }
    const { reviewer, subject, weight } = raw as Record<string, unknown>;
    for (const [key, id] of [
      ["reviewer", reviewer],
      ["subject", subject],
    ] as const) {
      if (typeof id !== "string" || id.length === 0) {
        return {
          ok: false,
          error: apiError(
            400,
            "INVALID_INPUT",
            `"${field}[${i}].${key}" must be a non-empty string.`,
            `Set "${key}" to the agent's id string (1-${MAX_ID_LENGTH} characters).`,
          ),
        };
      }
      if (id.length > MAX_ID_LENGTH) {
        return {
          ok: false,
          error: apiError(
            400,
            "INVALID_INPUT",
            `"${field}[${i}].${key}" is longer than ${MAX_ID_LENGTH} characters.`,
            `Use agent ids of at most ${MAX_ID_LENGTH} characters.`,
          ),
        };
      }
    }
    if (reviewer === subject) {
      return {
        ok: false,
        error: apiError(
          400,
          "SELF_REVIEW",
          `"${field}[${i}]" is a self-review ("${reviewer as string}" reviewing itself).`,
          `Remove or fix the record at index ${i}; reviewer and subject must differ.`,
        ),
      };
    }
    if (weight !== undefined) {
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        return {
          ok: false,
          error: apiError(
            400,
            "INVALID_INPUT",
            `"${field}[${i}].weight" must be a finite number greater than 0.`,
            `Omit "weight" (defaults to 1) or set it to a positive number.`,
          ),
        };
      }
    }
    records.push({
      reviewer: reviewer as string,
      subject: subject as string,
      ...(weight !== undefined ? { weight: weight as number } : {}),
    });
  }
  return { ok: true, value: records };
}

/** Enforce the distinct-agent cap across one or more record arrays. */
export function checkAgentCount(recordArrays: ReviewRecord[][]): ApiError | null {
  const agents = new Set<string>();
  for (const records of recordArrays) {
    for (const r of records) {
      agents.add(r.reviewer);
      agents.add(r.subject);
    }
  }
  if (agents.size > MAX_AGENTS) {
    return apiError(
      413,
      "GRAPH_TOO_LARGE",
      `The graph names ${agents.size} distinct agents; the maximum is ${MAX_AGENTS}.`,
      `Split the graph and send at most ${MAX_AGENTS} distinct agents per request.`,
    );
  }
  return null;
}

export function validateNote(value: unknown): ApiError | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_NOTE_LENGTH) {
    return apiError(
      400,
      "INVALID_INPUT",
      `"note" must be a string of at most ${MAX_NOTE_LENGTH} characters.`,
      `Shorten or remove the optional "note" field.`,
    );
  }
  return null;
}
