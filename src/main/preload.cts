const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  obsConnect: (url: string, password: string) => ipcRenderer.invoke("obs:connect", { url, password }),
  recStart: (payload: { obs: { url: string; password: string }; udpListenPort: number; outDir: string }) =>
    ipcRenderer.invoke("rec:start", payload),
  recStop: () => ipcRenderer.invoke("rec:stop"),
  recStatus: () => ipcRenderer.invoke("rec:status"),
  getAppSettings: () => ipcRenderer.invoke("settings:getAll"),
  savePartialSettings: (payload: {
    rec?: { udpListenPort: number };
    play?: { targetIp: string; targetPort: number };
  }) => ipcRenderer.invoke("settings:savePartial", payload),
  findDefaultMedia: () => ipcRenderer.invoke("app:findDefaultMedia"),

  openFile: (filters: { name: string; extensions: string[] }[]) => ipcRenderer.invoke("dialog:openFile", { filters }),
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  pathToFileUrl: (filePath: string) => ipcRenderer.invoke("util:pathToFileUrl", { filePath }),

  playLoadLog: (udpLogPath: string) => ipcRenderer.invoke("play:loadLog", { udpLogPath }),
  playSetTarget: (ip: string, port: number) => ipcRenderer.invoke("play:setTarget", { ip, port }),
  playResetToTime: (tSec: number) => ipcRenderer.invoke("play:resetToTime", { tSec }),
  playTick: (videoTimeSec: number, offsetMs: number) => ipcRenderer.invoke("play:tick", { videoTimeSec, offsetMs })
});
