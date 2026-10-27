// Anthropic's subscription OAuth, as Claude Code signs in, plus the two read endpoints the app
// uses. Each account signs in once in the person's own browser (PKCE, loopback redirect), so
// Google sign-in and Cloudflare's browser check never involve this app. The token is requested
// with the `user:profile` scope only: it can read the profile and usage, and cannot run models.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LimitRow } from "./types.ts";

// Claude Code's public OAuth client id.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const SUCCESS_URL = "https://platform.claude.com/oauth/code/success?app=claude-code";
const API = "https://api.anthropic.com/api/oauth";
const SCOPE = "user:profile";

export interface Tokens {
  access: string;
  refresh: string;
  /** Epoch ms, five minutes before the access token actually expires. */
  expires: number;
}

/** A refresh or read that Anthropic refused because the sign-in is no longer valid. */
export class SignedOutError extends Error {}

/** Anthropic answered 429; the next timed refresh tries again. */
export class RateLimitedError extends Error {}

const base64url = (buf: Buffer) => buf.toString("base64url");

export interface LoginSession {
  url: string;
  /** Resolves with tokens once the browser redirects back; rejects on cancel or error. It waits
   * as long as it takes: the person may approve hours later, and Cancel in the popover ends it. */
  result: Promise<Tokens>;
  cancel(): void;
}

/** Starts a sign-in: a loopback server that waits for claude.ai's redirect with the code. */
export async function startLogin(): Promise<LoginSession> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));

  let settle!: { resolve: (t: Tokens) => void; reject: (e: Error) => void };
  const result = new Promise<Tokens>((resolve, reject) => (settle = { resolve, reject }));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== state || !code) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Sign-in failed: the response did not match this request.");
      settle.reject(new Error(url.searchParams.get("error_description") ?? "sign-in was refused or did not match"));
      return;
    }
    exchange(code, redirectUri)
      .then((tokens) => {
        res.writeHead(302, { location: SUCCESS_URL }).end();
        settle.resolve(tokens);
      })
      .catch((error: unknown) => {
        res.writeHead(500, { "content-type": "text/plain" }).end("Sign-in failed while exchanging the code.");
        settle.reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://localhost:${(server.address() as AddressInfo).port}/callback`;

  void result.catch(() => undefined).finally(() => {
    server.close();
    server.closeAllConnections();
  });

  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return {
    url: `${AUTHORIZE_URL}?${params}`,
    result,
    cancel: () => settle.reject(new Error("cancelled")),
  };

  async function exchange(code: string, redirect: string): Promise<Tokens> {
    return tokenRequest({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
  }
}

export function refreshTokens(refresh: string): Promise<Tokens> {
  return tokenRequest({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refresh });
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (res.status === 400 && /invalid_grant/.test(text)) throw new SignedOutError("Anthropic no longer accepts this sign-in");
  if (res.status === 429) throw new RateLimitedError("Anthropic is rate-limiting token requests");
  if (!res.ok) throw new Error(`token request answered HTTP ${res.status}`);
  const data = JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function apiGet<T>(path: string, access: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    headers: { authorization: `Bearer ${access}`, "anthropic-beta": "oauth-2025-04-20", accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new SignedOutError(`/${path} answered 401`);
  if (res.status === 429) throw new RateLimitedError("Anthropic is rate-limiting usage reads");
  if (!res.ok) throw new Error(`/${path} answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export interface Profile {
  accountId: string;
  email: string | null;
  orgName: string | null;
}

export async function readProfile(access: string): Promise<Profile> {
  const body = await apiGet<{
    account?: { uuid?: string; email?: string };
    organization?: { name?: string };
  }>("profile", access);
  if (!body.account?.uuid) throw new Error("the profile response has no account id");
  return { accountId: body.account.uuid, email: body.account.email ?? null, orgName: body.organization?.name ?? null };
}

interface RawWindow {
  utilization: number | null;
  resets_at: string | null;
}

interface RawUsage {
  five_hour?: RawWindow | null;
  seven_day?: RawWindow | null;
  seven_day_opus?: RawWindow | null;
  seven_day_sonnet?: RawWindow | null;
  limits?: Array<{
    kind: string;
    percent: number;
    severity: string;
    resets_at: string | null;
    scope: { model?: { display_name?: string | null } | null; surface?: string | null } | null;
  }> | null;
}

export async function readUsage(access: string): Promise<LimitRow[]> {
  return limitRows(await apiGet<RawUsage>("usage", access));
}

const KIND_LABELS: Record<string, string> = {
  session: "5-hour session",
  weekly_all: "Weekly · all models",
};

function limitRows(usage: RawUsage): LimitRow[] {
  if (usage.limits) {
    return usage.limits.map((limit) => ({
      kind: limit.kind,
      label:
        KIND_LABELS[limit.kind] ??
        (limit.kind === "weekly_scoped"
          ? `Weekly · ${limit.scope?.model?.display_name ?? limit.scope?.surface ?? "scoped"}`
          : limit.kind),
      percent: limit.percent,
      severity: limit.severity,
      resetsAt: limit.resets_at,
    }));
  }
  // Older response shape without `limits`: read the named windows that are present.
  const windows: Array<[string, string, RawWindow | null | undefined]> = [
    ["session", "5-hour session", usage.five_hour],
    ["weekly_all", "Weekly · all models", usage.seven_day],
    ["weekly_scoped", "Weekly · Opus", usage.seven_day_opus],
    ["weekly_scoped", "Weekly · Sonnet", usage.seven_day_sonnet],
  ];
  return windows.flatMap(([kind, label, window]) =>
    window && window.utilization !== null
      ? [{ kind, label, percent: window.utilization, severity: "normal", resetsAt: window.resets_at }]
      : [],
  );
}
