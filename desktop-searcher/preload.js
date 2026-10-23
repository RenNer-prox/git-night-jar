const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nightjarSearcher", {
  navigate: (address, provider) => ipcRenderer.invoke("searcher:navigate", address, provider),
  back: () => ipcRenderer.invoke("searcher:back"),
  forward: () => ipcRenderer.invoke("searcher:forward"),
  reload: () => ipcRenderer.invoke("searcher:reload"),
  home: () => ipcRenderer.invoke("searcher:home"),
  onState: (callback) => ipcRenderer.on("searcher:state", (_event, state) => callback(state)),
  onLoading: (callback) => ipcRenderer.on("searcher:loading", (_event, loading) => callback(loading)),
  onError: (callback) => ipcRenderer.on("searcher:error", (_event, message) => callback(message)),
});
