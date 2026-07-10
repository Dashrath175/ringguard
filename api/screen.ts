import { runScreen } from "../lib/engine";
import { checkBodySize, readJsonBody, requireMethod, sendError, sendInternalError, sendJson, type HttpRequest, type HttpResponse } from "../lib/http";
import { apiError, checkAgentCount, validateRecords, MAX_RECORDS } from "../lib/validate";

export default function handler(req: HttpRequest, res: HttpResponse): void {
  try {
    if (
      !requireMethod(
        req,
        res,
        "POST",
        'POST a JSON body like {"records":[...existing...],"candidate_records":[...proposed...]} to check whether accepting the candidates would create a collusion ring.',
      )
    ) {
      return;
    }
    const sizeError = checkBodySize(req);
    if (sizeError) return sendError(res, sizeError);

    const body = readJsonBody(req);
    if (!body.ok) return sendError(res, body.error);

    // The existing ledger may legitimately be empty; the candidates may not.
    const records = validateRecords(body.value.records, "records", { allowEmpty: true });
    if (!records.ok) return sendError(res, records.error);

    const candidates = validateRecords(body.value.candidate_records, "candidate_records");
    if (!candidates.ok) return sendError(res, candidates.error);

    if (records.value.length + candidates.value.length > MAX_RECORDS) {
      return sendError(
        res,
        apiError(
          413,
          "GRAPH_TOO_LARGE",
          `"records" plus "candidate_records" total ${records.value.length + candidates.value.length} records; the combined maximum is ${MAX_RECORDS}.`,
          `Send at most ${MAX_RECORDS} records per request, counting both arrays.`,
        ),
      );
    }
    const agentError = checkAgentCount([records.value, candidates.value]);
    if (agentError) return sendError(res, agentError);

    sendJson(res, 200, runScreen(records.value, candidates.value));
  } catch (err) {
    sendInternalError(res, err);
  }
}
