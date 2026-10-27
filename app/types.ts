// The state the popover page renders. Every number is copied from Anthropic's own usage
// response (GET /api/oauth/usage, the endpoint Claude Code's /usage reads); nothing is estimated.

export interface LimitRow {
  /** Anthropic's limit kind: "session" (5-hour), "weekly_all", or "weekly_scoped" (one model). */
  kind: string;
  /** "5-hour session", "Weekly · all models", "Weekly · Fable", ... */
  label: string;
  percent: number;
  /** "normal" | "warning" | "critical", as Anthropic reports it. */
  severity: string;
  resetsAt: string | null;
}

export type AccountStatus =
  | "loading" // no read has finished since the app started
  | "ok"
  | "signed_out" // the stored sign-in was revoked or expired; sign in again
  | "error"; // the last read failed; `limits` are from the last good read

export interface AccountState {
  /** Anthropic's account uuid. */
  id: string;
  label: string;
  email: string | null;
  status: AccountStatus;
  message: string | null;
  limits: LimitRow[];
  /** When `limits` was fetched. Older data is kept, and shown as stale, after a failed refresh. */
  fetchedAt: string | null;
}

export interface PendingLogin {
  /** The claude.ai authorize link, opened in the default browser; copyable for another browser. */
  url: string;
  error: string | null;
}

export interface DashboardState {
  refreshIntervalMs: number;
  accounts: AccountState[];
  pendingLogin: PendingLogin | null;
  openAtLogin: boolean;
  refreshing: boolean;
}

/** What the preload script exposes to the page as `window.usage`. */
export interface UsageApi {
  getState(): Promise<DashboardState>;
  onState(listener: (state: DashboardState) => void): () => void;
  refresh(): Promise<void>;
  addAccount(): Promise<void>;
  /** Opens the pending sign-in link in the default browser again; after a failed sign-in, starts a new one. */
  openLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  copyLoginLink(): Promise<void>;
  renameAccount(id: string, label: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  setOpenAtLogin(open: boolean): Promise<void>;
  quit(): Promise<void>;
  /** The page's content height, so the popover can fit it. */
  reportHeight(height: number): void;
}
