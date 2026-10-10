"use strict";

// Sandboxed preload: no Node APIs are exposed to the renderer. The desktop
// bridge is intentionally empty until a real native capability is required;
// additions must be narrowly scoped, validated functions — never raw
// ipcRenderer/fs/process handles.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("learnspaceDesktop", {
  platform: process.platform,
});
