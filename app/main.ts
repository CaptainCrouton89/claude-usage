// Claude Usage: a menu bar app. The tray shows how many registered accounts can be used now;
// clicking it opens a popover window with every account's limits. Usage is read over HTTP with
// each account's own OAuth sign-in every five minutes and when the Mac wakes. No browser runs.

import { app, BrowserWindow, clipboard, ipcMain, nativeImage, powerMonitor, screen, shell, Tray } from "electron";
import path from "node:path";
import {
  type LoginSession,
  RateLimitedError,
  readProfile,
  readUsage,
  refreshTokens,
  SignedOutError,
  startLogin,
} from "./anthropic.ts";
import { loadAccounts, saveAccounts, type StoredAccount } from "./store.ts";
import type { AccountState, DashboardState, PendingLogin } from "./types.ts";

const REFRESH_MS = 5 * 60 * 1000;
const WIDTH = 400;

// A dev run (`pnpm dev`) keeps its own accounts and Keychain key, apart from the installed app.
app.setName(app.isPackaged ? "Claude Usage" : "Claude Usage Dev");
if (!app.requestSingleInstanceLock()) app.exit(0);

let stored: StoredAccount[] = [];
const states = new Map<string, AccountState>();
let pending: { session: LoginSession; view: PendingLogin } | null = null;
let refreshing: Promise<void> | null = null;
let tray: Tray | null = null;
let win: BrowserWindow | null = null;

// --- state ------------------------------------------------------------------------------------

function stateFor(account: StoredAccount): AccountState {
  let state = states.get(account.id);
  if (!state) {
    state = { id: account.id, label: account.label, email: account.email, status: "loading", message: null, limits: [], fetchedAt: null };
    states.set(account.id, state);
  }
  return state;
}

function snapshot(): DashboardState {
  return {
    refreshIntervalMs: REFRESH_MS,
    accounts: stored.map(stateFor),
    pendingLogin: pending?.view ?? null,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    refreshing: refreshing !== null,
  };
}

function publish(): void {
  updateTray();
  win?.webContents.send("state", snapshot());
}

// --- reading usage ----------------------------------------------------------------------------

async function freshAccess(account: StoredAccount): Promise<string> {
  if (Date.now() < account.tokens.expires) return account.tokens.access;
  account.tokens = await refreshTokens(account.tokens.refresh);
  saveAccounts(stored); // refresh tokens rotate: persist the new one before anything else can fail
  return account.tokens.access;
}

async function refreshAccount(account: StoredAccount): Promise<void> {
  const state = stateFor(account);
  try {
    let limits;
    try {
      limits = await readUsage(await freshAccess(account));
    } catch (error) {
      // An access token revoked before its expiry: refresh once and retry.
      if (!(error instanceof SignedOutError) || account.tokens.expires === 0) throw error;
      account.tokens.expires = 0;
      limits = await readUsage(await freshAccess(account));
    }
    Object.assign(state, { status: "ok", message: null, limits, fetchedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof SignedOutError) {
      // Usage from an earlier sign-in may no longer describe this account: drop it.
      Object.assign(state, { status: "signed_out", message, limits: [], fetchedAt: null });
    } else {
      Object.assign(state, { status: "error", message: error instanceof RateLimitedError ? message : `Refresh failed: ${message}` });
    }
  }
  console.log(`[${account.label}] ${state.status}${state.message ? `: ${state.message}` : ""}`);
}

function refreshAll(): Promise<void> {
  refreshing ??= (async () => {
    publish();
    await Promise.all(stored.map(refreshAccount));
  })().finally(() => {
    refreshing = null;
    publish();
  });
  return refreshing;
}

// --- sign-in ----------------------------------------------------------------------------------

async function beginLogin(): Promise<void> {
  // A sign-in still waiting is reused; a failed one (timed out, refused) is replaced.
  if (pending && !pending.view.error) return;
  pending = null;
  const session = await startLogin();
  pending = { session, view: { url: session.url, error: null } };
  publish();
  void shell.openExternal(session.url);
  session.result.then(
    (tokens) => void finishLogin(session, tokens),
    (error: unknown) => {
      if (pending?.session !== session) return;
      const message = error instanceof Error ? error.message : String(error);
      pending = message === "cancelled" ? null : { session, view: { ...pending.view, error: message } };
      publish();
    },
  );
}

async function finishLogin(session: LoginSession, tokens: StoredAccount["tokens"]): Promise<void> {
  try {
    const profile = await readProfile(tokens.access);
    const existing = stored.find((a) => a.id === profile.accountId);
    if (existing) {
      Object.assign(existing, { tokens, email: profile.email });
    } else {
      stored.push({ id: profile.accountId, label: profile.email?.split("@")[0] ?? "Claude account", email: profile.email, tokens });
    }
    saveAccounts(stored);
    if (pending?.session === session) pending = null;
    const account = stored.find((a) => a.id === profile.accountId)!;
    Object.assign(stateFor(account), { email: profile.email });
    publish();
    await refreshAccount(account);
    publish();
    showPopover();
  } catch (error) {
    if (pending?.session === session) {
      pending = { session, view: { ...pending.view, error: error instanceof Error ? error.message : String(error) } };
      publish();
    }
  }
}

// --- tray and popover -------------------------------------------------------------------------

function updateTray(): void {
  if (!tray) return;
  const accounts = stored.map(stateFor);
  const usable = accounts.filter((a) => a.status !== "signed_out" && a.limits.length > 0 && a.limits.every((l) => l.kind === "weekly_scoped" || l.percent < 100));
  const attention = accounts.some((a) => a.status === "signed_out");
  tray.setTitle(accounts.length === 0 ? "" : `${usable.length}/${accounts.length}${attention ? " !" : ""}`, { fontType: "monospacedDigit" });
  tray.setToolTip(
    accounts.length === 0
      ? "Claude Usage: no accounts yet"
      : accounts.map((a) => `${a.label}: ${describe(a)}`).join("\n"),
  );
}

function describe(account: AccountState): string {
  if (account.status === "signed_out") return "signed out";
  if (account.limits.length === 0) return account.status === "error" ? "error" : "loading";
  const weekly = account.limits.find((l) => l.kind === "weekly_all");
  const session = account.limits.find((l) => l.kind === "session");
  if (weekly && weekly.percent >= 100) return "weekly limit reached";
  if (session && session.percent >= 100) return "5-hour limit reached";
  return `available, ${Math.round(weekly?.percent ?? 0)}% of week used`;
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.on("blur", () => {
    if (!w.webContents.isDevToolsOpened()) w.hide();
  });
  // Links in the page open in the default browser, never inside the popover.
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event) => event.preventDefault());
  void w.loadFile(path.join(__dirname, "web/index.html"));
  return w;
}

function positionWindow(): void {
  if (!win || !tray) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const area = display.workArea;
  const { height } = win.getBounds();
  const x = Math.round(Math.min(Math.max(trayBounds.x + trayBounds.width / 2 - WIDTH / 2, area.x + 8), area.x + area.width - WIDTH - 8));
  const y = trayBounds.height > 0 ? trayBounds.y + trayBounds.height + 4 : area.y + 4;
  win.setBounds({ x, y, width: WIDTH, height });
}

function showPopover(): void {
  if (!win) return;
  positionWindow();
  win.show();
  win.focus();
  win.webContents.send("state", snapshot());
}

function togglePopover(): void {
  if (win?.isVisible()) win.hide();
  else showPopover();
}

// --- wiring -----------------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle("get-state", () => snapshot());
  ipcMain.handle("refresh", () => refreshAll());
  ipcMain.handle("add-account", () => beginLogin());
  ipcMain.handle("open-login", () => {
    // A failed sign-in's link is dead (its loopback server has closed): start a new one.
    if (pending?.view.error) return beginLogin();
    if (pending) void shell.openExternal(pending.view.url);
  });
  ipcMain.handle("copy-login-link", () => {
    if (pending) clipboard.writeText(pending.view.url);
  });
  ipcMain.handle("cancel-login", () => {
    if (!pending) return;
    // A failed sign-in has already settled, so cancelling its session would change nothing.
    if (pending.view.error) {
      pending = null;
      publish();
    } else {
      pending.session.cancel();
    }
  });
  ipcMain.handle("rename-account", (_e, id: string, label: string) => {
    const account = stored.find((a) => a.id === id);
    if (!account || !label.trim()) return;
    account.label = label.trim();
    stateFor(account).label = account.label;
    saveAccounts(stored);
    publish();
  });
  ipcMain.handle("remove-account", (_e, id: string) => {
    stored = stored.filter((a) => a.id !== id);
    states.delete(id);
    saveAccounts(stored);
    publish();
  });
  ipcMain.handle("set-open-at-login", (_e, open: boolean) => {
    app.setLoginItemSettings({ openAtLogin: open });
    publish();
  });
  ipcMain.handle("quit", () => app.quit());
  ipcMain.on("height", (_e, height: number) => {
    if (!win || !tray) return;
    const area = screen.getDisplayNearestPoint(tray.getBounds()).workArea;
    const h = Math.min(Math.ceil(height), area.height - 16);
    if (win.getBounds().height !== h) win.setBounds({ ...win.getBounds(), height: h });
  });
}

app.on("second-instance", showPopover);
// `open -a "Claude Usage"` on the running app (the tmux prefix+u binding) shows the popover.
app.on("activate", showPopover);

void app.whenReady().then(() => {
  app.dock?.hide();
  stored = loadAccounts();
  registerIpc();

  const icon = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", togglePopover);
  tray.on("right-click", togglePopover);
  win = createWindow();

  updateTray();
  void refreshAll();
  setInterval(() => void refreshAll(), REFRESH_MS);
  powerMonitor.on("resume", () => setTimeout(() => void refreshAll(), 10_000));
  if (stored.length === 0) win.webContents.once("did-finish-load", showPopover);
});

app.on("window-all-closed", () => {
  // A menu bar app keeps running with its popover hidden.
});
