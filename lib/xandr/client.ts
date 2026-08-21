/**
 * The only place Xandr HTTP calls are made from.
 *
 * Three things about this API drive the whole design:
 *
 *  1. The auth header is `Authorization: <token>` — raw, no `Bearer` prefix.
 *  2. An error can arrive with HTTP 200 and `response.error_id` set, so the
 *     body must be inspected on every call, not just the status.
 *  3. Tokens last two hours. We cache for ninety minutes and, unlike the
 *     gateway, retry the request once after a fresh login when a call comes
 *     back NOAUTH. The gateway instead probes GET /member before every
 *     invocation, which costs a round-trip and still races an expiry.
 */

import { fetchWithTimeout } from "../assets";
import { baseUrl, credentials } from "./config";
import type { AuthResponse, XandrEnvelope, XandrResponseMeta } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

/** Xandr tokens are valid for 2 h; we refresh at 90 min like the gateway does. */
const TOKEN_TTL_MS = 90 * 60 * 1000;

/** Rate-limit retries. Xandr sends Retry-After; this is the fallback. */
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 2;

export class XandrError extends Error {
  readonly status: number;
  readonly errorId?: string;
  readonly errorCode?: string | null;
  readonly description?: string | null;
  readonly service?: string;
  readonly method?: string;

  constructor(
    message: string,
    init: {
      status: number;
      errorId?: string;
      errorCode?: string | null;
      description?: string | null;
      service?: string;
      method?: string;
    }
  ) {
    super(message);
    this.name = "XandrError";
    this.status = init.status;
    this.errorId = init.errorId;
    this.errorCode = init.errorCode;
    this.description = init.description;
    this.service = init.service;
    this.method = init.method;
  }

  /** The token was rejected — worth one re-login and retry. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.errorId === "NOAUTH";
  }

  /** 405 is Xandr's legacy rate-limit status, kept alongside 429. */
  get isRateLimited(): boolean {
    return (
      this.status === 429 ||
      this.status === 405 ||
      this.errorCode === "RATE_EXCEEDED"
    );
  }
}

// ------------------------------------------------------------- token cache

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Module-level, so one warm server process logs in once. A single Node
 * process needs no shared store; the gateway's DynamoDB table exists only
 * because every Lambda invocation starts cold.
 */
let cached: CachedToken | null = null;

/** In-flight login, so concurrent callers share one round-trip. */
let pending: Promise<string> | null = null;

export function clearToken(): void {
  cached = null;
  pending = null;
}

async function login(): Promise<string> {
  const { username, password } = credentials();
  const res = await fetchWithTimeout(
    new URL("auth", baseUrl()).toString(),
    REQUEST_TIMEOUT_MS,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ auth: { username, password } }),
    }
  );

  const body = (await readJson(res)) as Partial<XandrEnvelope<AuthResponse>>;
  const response = body?.response;
  if (!res.ok || !response?.token) {
    throw toXandrError(res.status, response, "POST", "auth");
  }

  cached = { token: response.token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return response.token;
}

/** The cached token, logging in when it is missing or close to expiry. */
export async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (pending) return pending;

  pending = login().finally(() => {
    pending = null;
  });
  return pending;
}

// ----------------------------------------------------------------- requests

export interface XandrRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Service path, e.g. "creative" or "line-item". No leading slash. */
  service: string;
  params?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Multipart body. Set instead of `body`; no content-type is added. */
  form?: FormData;
  timeoutMs?: number;
}

function buildUrl(
  service: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const url = new URL(service, baseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Xandr occasionally answers with an HTML error page from a proxy.
    return { message: text.slice(0, 500) };
  }
}

/**
 * Build an error from whatever shape came back. Most services use
 * `{ response: { error_id, error, ... } }`; /creative-upload answers with a
 * bare `{ message }` instead, so both are handled here.
 */
function toXandrError(
  status: number,
  response: XandrResponseMeta | undefined,
  method: string,
  service: string,
  fallbackMessage?: string
): XandrError {
  const message =
    response?.error ||
    fallbackMessage ||
    `Xandr ${method} /${service} failed with status ${status}.`;
  return new XandrError(message, {
    status,
    errorId: response?.error_id,
    errorCode: response?.error_code,
    description: response?.error_description,
    service: response?.service ?? service,
    method: response?.method ?? method,
  });
}

/** Non-envelope errors, e.g. from the media upload service. */
function bareMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_MS;
  // A small buffer past the window, capped so a bad header cannot stall a request.
  return Math.min(seconds * 1000 + 500, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(req: XandrRequest, token: string): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/json",
    // Raw token, no scheme. Xandr does not use Bearer.
    authorization: token,
  };
  let payload: BodyInit | undefined;
  if (req.form) {
    payload = req.form;
  } else if (req.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(req.body);
  }

  return fetchWithTimeout(
    buildUrl(req.service, req.params),
    req.timeoutMs ?? REQUEST_TIMEOUT_MS,
    { method: req.method, headers, body: payload }
  );
}

/**
 * One Xandr call, unwrapped. Retries once after a fresh login on NOAUTH, and
 * up to twice on a rate limit, honouring Retry-After.
 */
export async function request<T>(req: XandrRequest): Promise<T & XandrResponseMeta> {
  let reauthed = false;
  let rateLimitAttempts = 0;

  for (;;) {
    const token = await getToken();
    const res = await send(req, token);
    const body = await readJson(res);
    const envelope = body as Partial<XandrEnvelope<T>> | null;
    const response = envelope?.response;

    const failed = !res.ok || !response || Boolean(response.error_id);
    if (!failed) return response as T & XandrResponseMeta;

    const error = toXandrError(
      res.status,
      response,
      req.method,
      req.service,
      bareMessage(body)
    );

    if (error.isAuthFailure && !reauthed) {
      reauthed = true;
      clearToken();
      continue;
    }

    if (error.isRateLimited && rateLimitAttempts < RATE_LIMIT_ATTEMPTS) {
      rateLimitAttempts += 1;
      await sleep(retryAfterMs(res));
      continue;
    }

    throw error;
  }
}
