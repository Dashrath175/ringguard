import { requireMethod, sendInternalError, sendJson, type HttpRequest, type HttpResponse } from "../lib/http";
import { SERVICE_NAME, VERSION } from "../lib/types";

export default function handler(req: HttpRequest, res: HttpResponse): void {
  try {
    if (!requireMethod(req, res, "GET", "GET this endpoint (no body) for a liveness check.")) {
      return;
    }
    sendJson(res, 200, {
      status: "ok",
      service: SERVICE_NAME,
      version: VERSION,
      time: new Date().toISOString(),
    });
  } catch (err) {
    sendInternalError(res, err);
  }
}
