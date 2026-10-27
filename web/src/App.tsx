import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  ProgressBar,
  Spinner,
  TextField,
} from "@northlight-systems/cloud-ui";
import {
  CircleCheck,
  Copy,
  Ellipsis,
  ExternalLink,
  LogIn,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from "@northlight-systems/cloud-ui/icons";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AccountState, DashboardState, LimitRow, UsageApi } from "../../app/types.ts";

declare global {
  interface Window {
    usage: UsageApi;
  }
}

const api = window.usage;

export function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const now = useNow();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getState().then(setState);
    return api.onState(setState);
  }, []);

  // The popover window takes the page's height, up to the screen.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => api.reportHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className="p-1">
      <div className="flex flex-col overflow-hidden rounded-xl border border-default bg-canvas text-default shadow-lg">
        <header className="flex items-center gap-1 border-b border-default px-3 py-2">
          <h1 className="m-0 flex-1 text-label">Claude usage</h1>
          <IconButton
            aria-label="Refresh now"
            variant="ghost-muted"
            size="xs"
            isPending={state?.refreshing ?? false}
            onPress={() => void api.refresh()}
          >
            <RefreshCw />
          </IconButton>
          <IconButton aria-label="Add account" variant="ghost-muted" size="xs" onPress={() => void api.addAccount()}>
            <Plus />
          </IconButton>
          <AppMenu openAtLogin={state?.openAtLogin ?? false} />
        </header>

        {/* Capped by the screen, not the window: the window takes the page's height, so a cap
            tied to the window would shrink the page and the window together. */}
        <main className="flex flex-col gap-3 overflow-y-auto p-3" style={{ maxHeight: window.screen.availHeight - 120 }}>
          {state === null && <Spinner aria-label="Loading" />}
          {state?.pendingLogin && <PendingLogin login={state.pendingLogin} />}
          {state && state.accounts.length === 0 && !state.pendingLogin && (
            <div className="flex flex-col items-start gap-3 p-2">
              <p className="m-0 text-body">No Claude accounts yet.</p>
              <p className="m-0 text-small text-muted">
                Add an account to sign it in from your browser. Add each account you want to track, one at a time.
              </p>
              <Button variant="primary" size="sm" onPress={() => void api.addAccount()}>
                Add account
              </Button>
            </div>
          )}
          {state && state.accounts.length > 0 && <AccountTable accounts={state.accounts} now={now} staleAfterMs={state.refreshIntervalMs * 2} />}
        </main>
      </div>
    </div>
  );
}

function AppMenu({ openAtLogin }: { openAtLogin: boolean }) {
  return (
    <MenuTrigger>
      <IconButton aria-label="App menu" variant="ghost-muted" size="xs">
        <Ellipsis />
      </IconButton>
      <Menu
        onAction={(key) => {
          if (key === "login") void api.setOpenAtLogin(!openAtLogin);
          if (key === "quit") void api.quit();
        }}
      >
        <MenuItem id="login" icon={openAtLogin ? CircleCheck : Power}>
          {openAtLogin ? "Opens at login" : "Open at login"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="quit" icon={Power}>
          Quit Claude Usage
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function PendingLogin({ login }: { login: NonNullable<DashboardState["pendingLogin"]> }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-zone p-3">
      {login.error ? (
        <Alert tone="danger" title="Sign-in failed">
          {login.error}
        </Alert>
      ) : (
        <div className="flex items-center gap-2 text-small">
          <Spinner size="sm" aria-label="Waiting for sign-in" />
          Waiting for you to sign in and approve in the browser.
        </div>
      )}
      <p className="m-0 text-small text-muted">
        Sign in to claude.ai as the account to add. If your default browser is signed in to a different account, copy the
        link into a browser profile that has the right one.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onPress={() => void api.openLogin()}>
          <ExternalLink className="size-4" /> {login.error ? "Try again" : "Open again"}
        </Button>
        {!login.error && (
          <Button variant="secondary" size="sm" onPress={() => void api.copyLoginLink()}>
            <Copy className="size-4" /> Copy link
          </Button>
        )}
        <Button variant="ghost" size="sm" onPress={() => void api.cancelLogin()}>
          {login.error ? "Dismiss" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

/**
 * One row per account, one column per limit, so several accounts compare at a glance. The first
 * column says whether the account is usable now and, if not, when it is back; each limit cell
 * shows the percent used and the time until that limit resets.
 */
function AccountTable({ accounts, now, staleAfterMs }: { accounts: AccountState[]; now: number; staleAfterMs: number }) {
  // Model-scoped weekly limits differ by plan; show every one any account reports.
  const scopedLabels = [...new Set(accounts.flatMap((a) => a.limits.filter((l) => l.kind === "weekly_scoped").map((l) => l.label)))];
  const columns: Array<{ key: string; title: string; pick: (a: AccountState) => LimitRow | undefined }> = [
    { key: "week", title: "Week", pick: (a) => a.limits.find((l) => l.kind === "weekly_all") },
    { key: "session", title: "5-hour", pick: (a) => a.limits.find((l) => l.kind === "session") },
    ...scopedLabels.map((label) => ({
      key: label,
      title: label.replace(/^Weekly · /, ""),
      pick: (a: AccountState) => a.limits.find((l) => l.label === label),
    })),
  ];
  const grid = { gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, 3.75rem) 1.25rem` };

  return (
    <div className="flex flex-col">
      <div className="grid items-end gap-x-2 px-1 pb-1.5 text-small text-muted" style={grid}>
        <span />
        {columns.map((c) => (
          <span key={c.key} className="truncate">
            {c.title}
          </span>
        ))}
        <span />
      </div>
      {sortAccounts(accounts).map((account) => (
        <AccountRow key={account.id} account={account} columns={columns} grid={grid} now={now} staleAfterMs={staleAfterMs} />
      ))}
      <p className="m-0 px-1 pt-2 text-small text-muted">Used · resets in · idle = no 5-hour window open</p>
    </div>
  );
}

function AccountRow({
  account,
  columns,
  grid,
  now,
  staleAfterMs,
}: {
  account: AccountState;
  columns: Array<{ key: string; pick: (a: AccountState) => LimitRow | undefined }>;
  grid: CSSProperties;
  now: number;
  staleAfterMs: number;
}) {
  const fetchedMs = account.fetchedAt ? Date.parse(account.fetchedAt) : null;
  const stale = fetchedMs !== null && (account.status !== "ok" || now - fetchedMs > staleAfterMs);
  const availability = availabilityOf(account, now);

  return (
    <section className="flex flex-col gap-2 border-t border-default px-1 py-2.5">
      <div className="grid items-start gap-x-2" style={grid}>
        <div className="flex min-w-0 flex-col gap-0.5" title={account.email ?? undefined}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`size-2 shrink-0 rounded-full ${DOT[availability.tone]}`} aria-hidden />
            <h2 className="m-0 truncate text-label">{account.label}</h2>
          </div>
          <span className={`truncate pl-3.5 text-small ${TEXT[availability.tone]}`}>{availability.text}</span>
        </div>
        {columns.map((c) => (
          <LimitCell key={c.key} limit={c.pick(account)} now={now} />
        ))}
        <AccountMenu account={account} />
      </div>
      {(stale || account.status === "error") && (
        <div className="flex items-center gap-2 pl-3.5">
          <StatusBadge account={account} stale={stale} />
          <span className="truncate text-small text-muted">
            {account.status === "error" ? account.message : null}
            {account.status !== "error" && account.fetchedAt ? `Figures from ${formatAgo(now - Date.parse(account.fetchedAt))}` : null}
          </span>
        </div>
      )}
      {account.status === "signed_out" && (
        <div className="flex items-center gap-2 pl-3.5">
          <span className="flex-1 text-small text-muted">Anthropic no longer accepts this sign-in.</span>
          <Button variant="primary" size="sm" onPress={() => void api.addAccount()}>
            <LogIn className="size-4" /> Sign in again
          </Button>
        </div>
      )}
    </section>
  );
}

function LimitCell({ limit, now }: { limit: LimitRow | undefined; now: number }) {
  if (!limit) return <span className="text-small text-muted">—</span>;
  const full = limit.percent >= 100;
  const tone = full || limit.severity === "critical" ? "danger" : limit.severity === "warning" ? "warning" : "accent";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`text-label tabular-nums leading-none ${full ? "text-danger" : ""}`}>{Math.round(limit.percent)}%</span>
      <ProgressBar aria-label={`${limit.label} usage`} value={limit.percent} size="sm" tone={tone} />
      <span className="truncate text-small text-muted tabular-nums">
        {limit.resetsAt ? formatDuration(Date.parse(limit.resetsAt) - now) : "idle"}
      </span>
    </div>
  );
}

type Tone = "ok" | "blocked" | "unknown";
// bg-current takes the text colour, as the kit's ProgressBar fills do; bg-success is a faint tint.
const DOT: Record<Tone, string> = { ok: "bg-current text-success", blocked: "bg-current text-danger", unknown: "bg-current text-muted" };
const TEXT: Record<Tone, string> = { ok: "text-success", blocked: "text-danger", unknown: "text-muted" };

/** Whether the account can be used now; if a limit is full, when the last full one resets. */
function availabilityOf(account: AccountState, now: number): { tone: Tone; text: string } {
  if (account.status === "signed_out") return { tone: "unknown", text: "Signed out" };
  if (account.limits.length === 0) return { tone: "unknown", text: account.status === "loading" ? "Reading…" : "No data" };
  const full = account.limits.filter((l) => l.kind !== "weekly_scoped" && l.percent >= 100);
  if (full.length === 0) return { tone: "ok", text: "Available" };
  const back = Math.max(...full.map((l) => (l.resetsAt ? Date.parse(l.resetsAt) : Infinity)));
  if (!Number.isFinite(back)) return { tone: "blocked", text: "Limit reached" };
  return { tone: "blocked", text: `Back ${formatBack(back)}` };
}

function AccountMenu({ account }: { account: AccountState }) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [label, setLabel] = useState(account.label);
  return (
    <>
      <MenuTrigger>
        <IconButton aria-label={`${account.label} menu`} variant="ghost-muted" size="2xs" className="-mt-0.5">
          <Ellipsis />
        </IconButton>
        <Menu
          onAction={(key) => {
            if (key === "rename") {
              setLabel(account.label);
              setRenaming(true);
            }
            if (key === "sign-in") void api.addAccount();
            if (key === "remove") setRemoving(true);
          }}
        >
          <MenuItem id="rename" icon={Pencil}>
            Rename
          </MenuItem>
          <MenuItem id="sign-in" icon={LogIn}>
            Sign in again
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="remove" icon={Trash2} variant="destructive">
            Remove
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <Dialog title="Rename account" size="sm" isOpen={renaming} onOpenChange={setRenaming}>
        {({ close }) => (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void api.renameAccount(account.id, label).then(close);
            }}
          >
            <TextField label="Name" value={label} onChange={setLabel} autoFocus />
            <DialogFooter>
              <Button variant="secondary" size="sm" onPress={close}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
      <Dialog title={`Remove ${account.label}?`} size="sm" isOpen={removing} onOpenChange={setRemoving}>
        {({ close }) => (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body">The app forgets this account's sign-in. Add it again any time.</p>
            <DialogFooter>
              <Button variant="secondary" size="sm" onPress={close}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onPress={() => void api.removeAccount(account.id).then(close)}>
                Remove
              </Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>
    </>
  );
}

function StatusBadge({ account, stale }: { account: AccountState; stale: boolean }): ReactNode {
  if (account.status === "signed_out") return <Badge tone="warning">Signed out</Badge>;
  if (account.status === "error") return <Badge tone="danger">{stale ? "Stale" : "Error"}</Badge>;
  if (stale) return <Badge tone="warning">Stale</Badge>;
  return null;
}

/** Accounts usable now first, the least-used week first; then blocked ones, back soonest first. */
function sortAccounts(accounts: AccountState[]): AccountState[] {
  const now = Date.now();
  const tone = (a: AccountState) => ({ ok: 0, blocked: 1, unknown: 2 })[availabilityOf(a, now).tone];
  const weekly = (a: AccountState) => a.limits.find((l) => l.kind === "weekly_all");
  const key = (a: AccountState) => (tone(a) === 0 ? (weekly(a)?.percent ?? 0) : Date.parse(weekly(a)?.resetsAt ?? "9999-01-01"));
  return [...accounts].sort((a, b) => tone(a) - tone(b) || key(a) - key(b));
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** "Thu 5pm", or "5:30pm" when it is later today. */
function formatBack(ms: number): string {
  // Anthropic reports resets at hh:59:59.7; round to the minute so that reads as the hour.
  const at = new Date(Math.round(ms / 60_000) * 60_000);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: at.getMinutes() ? "2-digit" : undefined }).replace(/\s?([AP])M$/, (_m, x: string) => `${x.toLowerCase()}m`);
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return "just now";
  return `${formatDuration(ms)} ago`;
}
