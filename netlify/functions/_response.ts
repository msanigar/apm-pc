/**
 * Tiny helpers used by all Netlify Functions in this project.
 */
export type FnResponse = {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
};

const DEFAULT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // Backend / CDN cache: 1 day, with a long stale-while-revalidate so the API
  // stays responsive while the next scheduled sync runs.
  "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
};

export function json(body: unknown, statusCode = 200): FnResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: DEFAULT_HEADERS,
  };
}

export function notFound(message = "Not found"): FnResponse {
  return {
    statusCode: 404,
    body: JSON.stringify({ error: message }),
    headers: DEFAULT_HEADERS,
  };
}

export function badRequest(message: string): FnResponse {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: message }),
    headers: DEFAULT_HEADERS,
  };
}

export function serverError(err: unknown): FnResponse {
  const message = err instanceof Error ? err.message : String(err);
  return {
    statusCode: 500,
    body: JSON.stringify({ error: "server_error", message }),
    headers: DEFAULT_HEADERS,
  };
}
