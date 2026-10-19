// 在 fetch 层记录真实发出的 HTTP 请求。
// M0 验证过：pi-ai 的 onPayload 与真实请求体有差异，fetch 层记录才与服务器收到的完全一致。
import type { RecordFn } from "./events";

const SECRET_HEADERS = new Set(["authorization", "x-api-key", "api-key", "cookie", "proxy-authorization"]);

function parseBody(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createRecordingFetch(record: RecordFn): typeof fetch {
  const recordingFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = SECRET_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
    });
    const raw = request.body ? await request.clone().text() : undefined;
    record("http_request", "harness", { url: request.url, method: request.method, headers, body: parseBody(raw) });

    const response = await fetch(request);
    record("http_response", "harness", { url: request.url, status: response.status });
    return response;
  };
  return recordingFetch as typeof fetch;
}
