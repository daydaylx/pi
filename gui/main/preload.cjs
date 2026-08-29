/**
 * Preload: die schmale Brücke (R11). Sie transportiert ausschließlich die
 * hier freigegebenen Aufrufe und Ereignisse — keine Agentenlogik.
 * Läuft im sandbox:true-Modus, daher CommonJS ohne Node-Module.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piGui", {
  startSession: (options) => ipcRenderer.invoke("gui:startSession", options),
  stopSession: () => ipcRenderer.invoke("gui:stopSession"),
  newSession: () => ipcRenderer.invoke("gui:newSession"),
  getMessages: () => ipcRenderer.invoke("gui:getMessages"),
  getState: () => ipcRenderer.invoke("gui:getState"),
  prompt: (message) => ipcRenderer.invoke("gui:prompt", message),
  abort: () => ipcRenderer.invoke("gui:abort"),
  setModel: (provider, modelId) =>
    ipcRenderer.invoke("gui:setModel", { provider, modelId }),
  setThinkingLevel: (level) =>
    ipcRenderer.invoke("gui:setThinkingLevel", level),
  listModels: () => ipcRenderer.invoke("gui:listModels"),
  listThinkingLevels: () => ipcRenderer.invoke("gui:listThinkingLevels"),
  listCommands: () => ipcRenderer.invoke("gui:listCommands"),
  getStats: () => ipcRenderer.invoke("gui:getStats"),
  getShortcuts: () => ipcRenderer.invoke("gui:getShortcuts"),
  cycleModel: () => ipcRenderer.invoke("gui:cycleModel"),
  cycleThinkingLevel: () => ipcRenderer.invoke("gui:cycleThinkingLevel"),
  listSessions: () => ipcRenderer.invoke("gui:listSessions"),
  switchSession: (sessionPath) =>
    ipcRenderer.invoke("gui:switchSession", sessionPath),
  respondUiRequest: (payload) =>
    ipcRenderer.invoke("gui:respondUiRequest", payload),
  onEvent: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("gui:event", (_event, payload) => callback(payload));
  },
  onPiExit: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("gui:pi-exit", (_event, payload) => callback(payload));
  },
});
