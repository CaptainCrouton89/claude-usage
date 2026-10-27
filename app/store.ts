// The registered accounts and their sign-ins. The file lives in the app's userData directory and
// is encrypted with Electron's safeStorage, whose key macOS keeps in the login Keychain under
// "Claude Usage Safe Storage". Tokens never reach the page; it only sees AccountState.

import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Tokens } from "./anthropic.ts";

export interface StoredAccount {
  /** Anthropic's account uuid; one entry per account. */
  id: string;
  label: string;
  email: string | null;
  tokens: Tokens;
}

const file = () => path.join(app.getPath("userData"), "accounts.bin");

export function loadAccounts(): StoredAccount[] {
  if (!fs.existsSync(file())) return [];
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))) as StoredAccount[];
}

export function saveAccounts(accounts: StoredAccount[]): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(accounts)), { mode: 0o600 });
  fs.renameSync(tmp, file());
}
