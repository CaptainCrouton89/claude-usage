// Exposes the popover's narrow API as `window.usage`. The page never sees a token.

import { contextBridge, ipcRenderer } from "electron";
import type { DashboardState, UsageApi } from "./types.ts";

const api: UsageApi = {
  getState: () => ipcRenderer.invoke("get-state"),
  onState: (listener) => {
    const handler = (_event: unknown, state: DashboardState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.off("state", handler);
  },
  refresh: () => ipcRenderer.invoke("refresh"),
  addAccount: () => ipcRenderer.invoke("add-account"),
  openLogin: () => ipcRenderer.invoke("open-login"),
  cancelLogin: () => ipcRenderer.invoke("cancel-login"),
  copyLoginLink: () => ipcRenderer.invoke("copy-login-link"),
  renameAccount: (id, label) => ipcRenderer.invoke("rename-account", id, label),
  removeAccount: (id) => ipcRenderer.invoke("remove-account", id),
  setOpenAtLogin: (open) => ipcRenderer.invoke("set-open-at-login", open),
  quit: () => ipcRenderer.invoke("quit"),
  reportHeight: (height) => ipcRenderer.send("height", height),
};

contextBridge.exposeInMainWorld("usage", api);
