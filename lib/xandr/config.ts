/**
 * Xandr connection settings.
 *
 * Everything is read from process.env inside the functions, never at module
 * load — the same rule lib/claude.ts follows, so importing this module is
 * always safe even when nothing is configured.
 *
 * We talk to Xandr directly rather than through the internal
 * xandr-api-gateway-v2 proxy. That gateway keeps credentials in AWS Secrets
 * Manager and its token in DynamoDB; neither fits a single Node process, so
 * both become env vars and an in-memory cache here.
 */

/**
 * There is only one Xandr API host. `api-test.appnexus.com` is a dead nginx
 * that 404s every path, and `sand.api.appnexus.com` no longer resolves —
 * "staging" at Alma means a test *member* on the production host, not a
 * separate environment. The internal gateway hardcodes this same URL.
 */
const DEFAULT_BASE_URL = "https://api.appnexus.com";

/** Alma's test member. The live one is 6931. */
export const TEST_MEMBER_ID = "13720";
const DEFAULT_MEMBER_ID = TEST_MEMBER_ID;

export interface XandrConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Only /creative-upload needs this. */
  memberId: string;
  /** Query parameter on every create call. */
  advertiserId: number;
  /** The line item is attached to this insertion order; we never create one. */
  insertionOrderId: number;
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** Base URL without a trailing slash question — new URL() needs one. */
export function baseUrl(): string {
  const raw = env("XANDR_BASE_URL") || DEFAULT_BASE_URL;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function memberId(): string {
  return env("XANDR_MEMBER_ID") || DEFAULT_MEMBER_ID;
}

/** True when a login could be attempted. Lets callers degrade instead of throw. */
export function hasXandrCredentials(): boolean {
  return Boolean(env("XANDR_USERNAME") && env("XANDR_PASSWORD"));
}

/** True when a booking could be attempted — credentials plus the two ids. */
export function isBookingConfigured(): boolean {
  return (
    hasXandrCredentials() &&
    Boolean(env("XANDR_ADVERTISER_ID")) &&
    Boolean(env("XANDR_INSERTION_ORDER_ID"))
  );
}

export function credentials(): { username: string; password: string } {
  const username = env("XANDR_USERNAME");
  const password = env("XANDR_PASSWORD");
  if (!username || !password) {
    throw new Error(
      "Xandr credentials are missing. Set XANDR_USERNAME and XANDR_PASSWORD."
    );
  }
  return { username, password };
}

function numericEnv(name: string): number {
  const raw = env(name);
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) {
    throw new Error(`${name} is missing or not a number.`);
  }
  return n;
}

export function advertiserId(): number {
  return numericEnv("XANDR_ADVERTISER_ID");
}

export function insertionOrderId(): number {
  return numericEnv("XANDR_INSERTION_ORDER_ID");
}

/** Everything at once, for the orchestrator. Throws on the first thing missing. */
export function config(): XandrConfig {
  const { username, password } = credentials();
  return {
    baseUrl: baseUrl(),
    username,
    password,
    memberId: memberId(),
    advertiserId: advertiserId(),
    insertionOrderId: insertionOrderId(),
  };
}

/**
 * True when booking under the test member. This is the only thing separating
 * a rehearsal from a live campaign — the host is the same either way, so the
 * member id is what callers must check.
 */
export function isTestMember(): boolean {
  return memberId() === TEST_MEMBER_ID;
}
