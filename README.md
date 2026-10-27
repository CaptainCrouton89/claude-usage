# Claude Usage

A macOS menu bar app that shows how much of each Claude subscription you have used. Use it if you have several Claude accounts and want to know which one still has room.

The menu bar shows how many accounts are usable now, e.g. `2/4`. Click it for a table with one row per account and one column per limit: the weekly limit, the 5-hour session, and any per-model weekly limit. Each cell shows the percent used and the time until that limit resets. An account at its limit shows when it is usable again.

It refreshes every 5 minutes and when the Mac wakes. No browser window runs in the background.

## Install

1. Download the zip for your Mac from the [latest release](https://github.com/CaptainCrouton89/claude-usage/releases/latest): `arm64` for Apple silicon, `x64` for Intel.
2. Unzip it and move **Claude Usage.app** to Applications.
3. Open it. The app is not notarized, so macOS blocks it the first time. Open **System Settings → Privacy & Security**, click **Open Anyway** next to "Claude Usage", and confirm.

   Or, in Terminal: `xattr -dr com.apple.quarantine "/Applications/Claude Usage.app"`

## Add an account

1. Click the menu bar item, then **+**.
2. Your browser opens claude.ai's sign-in page. Check "Logged in as …" at the bottom, then click **Authorize**.
3. Repeat for each account.

If your default browser is signed in to a different Claude account, click **Copy link** in the popover and open the link in a browser profile signed in to the right account.

The account menu (**⋯** on each row) renames an account, signs it in again, or removes it. The app menu (**⋯** at the top) turns **Open at login** on and quits the app.

## What it can access

- **Sign-in:** the same OAuth sign-in Claude Code uses, with the `user:profile` scope only. That scope reads your profile and usage. It cannot run models or read your conversations.
- **Data read:** `GET https://api.anthropic.com/api/oauth/usage`, the endpoint Claude Code's `/usage` reads, plus `/api/oauth/profile` for the account's email. Every number comes from Anthropic; nothing is estimated.
- **Storage:** the sign-ins are stored encrypted in `~/Library/Application Support/Claude Usage/accounts.bin`. The key is in your login Keychain under "Claude Usage Safe Storage". They are sent only to Anthropic.

This uses an Anthropic endpoint that is not documented for third parties, so it can stop working if Anthropic changes it.

## Build from source

Requires Node 22+, pnpm, and macOS.

The UI uses `@northlight-systems/cloud-ui`, a private GitHub Packages package. Installing it needs a GitHub token with access to it.

```sh
cp .env.example .env   # optional: signing identity, registry token
export NODE_AUTH_TOKEN="$(gh auth token)"
pnpm install
pnpm dev        # run from source, as "Claude Usage Dev" with its own accounts
pnpm package    # build and install ~/Applications/Claude Usage.app
pnpm release    # build arm64 and x64 zips into build/release
```

`pnpm package` signs with `CODESIGN_IDENTITY` from `.env`, or ad hoc if it is empty. With a stable identity, a rebuilt app reads its Keychain key without asking again.

`bin/claude-usage` opens the popover from a shell, for a keyboard shortcut.

## Layout

| Path | What it is |
|---|---|
| `app/main.ts` | Electron main process: menu bar item, popover window, refresh timer |
| `app/anthropic.ts` | OAuth sign-in (PKCE, loopback redirect), token refresh, usage and profile reads |
| `app/store.ts` | Encrypted account storage |
| `app/preload.ts` | The page's API (`window.usage`); the page never sees a token |
| `web/src/App.tsx` | The popover UI |
| `scripts/` | esbuild bundling and Electron packaging |

## License

MIT
