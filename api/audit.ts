import { runAudit } from "../lib/engine";
import { checkBodySize, readJsonBody, requireMethod, sendError, sendInternalError, sendJson, type HttpRequest, type HttpResponse } from "../lib/http";
import { checkAgentCount, validateNote, validateRecords } from "../lib/validate";

export default function handler(req: HttpRequest, res: HttpResponse): void {
  try {
    if (
      !requireMethod(
        req,
        res,
        "POST",
        'POST a JSON body like {"records":[{"reviewer":"a","subject":"b"}]} to this endpoint to receive a signed collusion audit.',
      )
    ) {
      return;
    }
    const sizeError = checkBodySize(req);
    if (sizeError) return sendError(res, sizeError);

    const body = readJsonBody(req);
    if (!body.ok) return sendError(res, body.error);

    const records = validateRecords(body.value.records, "records");
    if (!records.ok) return sendError(res, records.error);

    const agentError = checkAgentCount([records.value]);
    if (agentError) return sendError(res, agentError);

    const noteError = validateNote(body.value.note);
    if (noteError) return sendError(res, noteError);

    sendJson(res, 200, runAudit(records.value));
  } catch (err) {
    sendInternalError(res, err);
  }
}
