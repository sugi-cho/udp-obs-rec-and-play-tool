import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ObsController } from "./obs.js";
import { readJsonl } from "./log.js";
import { loadAppSettings, saveAppSettings } from "./settings.js";
import type { RecStartRequest } from "./types.js";
import { UdpPlayer } from "./udpPlayer.js";
import { UdpRelay } from "./udpRelay.js";
import { UdpRecorder } from "./udpRecorder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!app.isPackaged) {
  const devUserDataDir = path.join(app.getPath("temp"), "udp-obs-rec-and-play-tool-user-data");
  app.setPath("userData", devUserDataDir);
  app.commandLine.appendSwitch("disk-cache-dir", path.join(devUserDataDir, "Cache"));
}
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const obs = new ObsController();
const recorder = new UdpRecorder();
const player = new UdpPlayer();
const relay = new UdpRelay();
const detachRecorderListener = relay.addPacketListener((msg) => {
  recorder.handlePacket(msg);
});

function monotonicNowSec(): number {
  return Number(process.hrtime.bigint()) / 1e9;
}

function validatePort(port: number, fieldName: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${fieldName} は1-65535で指定してください。`);
  }
}

function normalizeRelayConfig(payload: {
  udpListenPort: number;
  forwardTargetIp: string;
  forwardTargetPort: number;
}): { udpListenPort: number; forwardTargetIp: string; forwardTargetPort: number } {
  validatePort(payload.udpListenPort, "UDP Listen Port");
  validatePort(payload.forwardTargetPort, "Forward Port");
  const forwardTargetIp = payload.forwardTargetIp.trim();
  if (!forwardTargetIp) {
    throw new Error("Forward IP を入力してください。");
  }
  if (payload.udpListenPort === payload.forwardTargetPort) {
    throw new Error("UDP Listen Port と Forward Port は別の値にしてください。");
  }
  return {
    udpListenPort: payload.udpListenPort,
    forwardTargetIp,
    forwardTargetPort: payload.forwardTargetPort
  };
}

async function applyRelayConfig(payload: {
  udpListenPort: number;
  forwardTargetIp: string;
  forwardTargetPort: number;
}): Promise<void> {
  const config = normalizeRelayConfig(payload);
  await relay.configure(config);
}

function findDefaultMedia(): {
  found: boolean;
  directory: string | null;
  mp4Path: string | null;
  logPath: string | null;
} {
  const candidates: string[] = [];
  const envDir = process.env.UDP_OBS_DEFAULT_MEDIA_DIR?.trim();
  if (envDir) {
    candidates.push(path.resolve(envDir));
  }

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "default-media"));
    candidates.push(path.join(path.dirname(app.getPath("exe")), "default-media"));
  } else {
    candidates.push(path.join(app.getAppPath(), "default-media"));
    candidates.push(path.join(process.cwd(), "default-media"));
  }

  const uniqueCandidates = [...new Set(candidates)];

  for (const dir of uniqueCandidates) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    let entries: string[];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }

    const mp4Name = entries.find((name) => name.toLowerCase().endsWith(".mp4"));
    const jsonlName = entries.find((name) => name.toLowerCase().endsWith(".jsonl"));
    const jsonName = entries.find((name) => name.toLowerCase().endsWith(".json"));
    const logName = jsonlName ?? jsonName;

    if (mp4Name && logName) {
      return {
        found: true,
        directory: dir,
        mp4Path: path.join(dir, mp4Name),
        logPath: path.join(dir, logName)
      };
    }
  }

  return {
    found: false,
    directory: null,
    mp4Path: null,
    logPath: null
  };
}

function createMainWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const initialWidth = Math.min(1280, workArea.width);
  const initialHeight = Math.min(1152, workArea.height);
  const shouldMaximize = workArea.height < 1152 || workArea.width < 1280;

  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  if (shouldMaximize) {
    win.maximize();
  }

  return win;
}

app.whenReady().then(() => {
  const settings = loadAppSettings();
  if (settings.rec) {
    void applyRelayConfig(settings.rec).catch(() => {
      // Ignore startup relay errors and let the UI surface them on action.
    });
  }
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    detachRecorderListener();
    void relay.stop();
    app.quit();
  }
});

ipcMain.handle("obs:connect", async (_event, cfg: { url: string; password: string }) => {
  await obs.connect(cfg);
  saveAppSettings({ obs: { url: cfg.url, password: cfg.password } });
  return { ok: true };
});

ipcMain.handle("rec:start", async (_event, payload: RecStartRequest) => {
  if (recorder.getStatus().running) {
    throw new Error("すでにREC中です。");
  }

  const relayConfig = normalizeRelayConfig(payload);
  await relay.configure(relayConfig);

  saveAppSettings({
    obs: {
      url: payload.obs.url,
      password: payload.obs.password
    },
    rec: relayConfig
  });

  await obs.startRecord(payload.obs);
  const t0Sec = monotonicNowSec();
  try {
    const session = await recorder.start({
      outDir: payload.outDir,
      t0Sec,
      meta: {
        appVersion: app.getVersion(),
        obsWsUrl: payload.obs.url,
        udpListenPort: relayConfig.udpListenPort,
        forwardTargetIp: relayConfig.forwardTargetIp,
        forwardTargetPort: relayConfig.forwardTargetPort
      }
    });

    return { ok: true, session };
  } catch (error) {
    if (obs.isConnected()) {
      try {
        await obs.stopRecord();
      } catch {
        // Keep original recorder error.
      }
    }
    throw error;
  }
});

ipcMain.handle("rec:stop", async () => {
  const wasRecording = recorder.getStatus().running;
  if (wasRecording) {
    await recorder.stop();
  }
  if (obs.isConnected()) {
    try {
      await obs.stopRecord();
    } catch (error) {
      if (wasRecording) {
        throw error;
      }
    }
  }
  return { ok: true };
});

ipcMain.handle("rec:status", async () => {
  const recStatus = recorder.getStatus();
  const relayStatus = relay.getStatus();
  return {
    ok: true,
    obsConnected: obs.isConnected(),
    recording: recStatus.running,
    forwarding: relayStatus.running,
    packetCount: recStatus.packetCount,
    session: recStatus.session,
    recentPackets: recStatus.recentPackets
  };
});

ipcMain.handle("dialog:openFile", async (_event, payload: { filters: { name: string; extensions: string[] }[] }) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: payload.filters
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("dialog:openDirectory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("util:pathToFileUrl", async (_event, payload: { filePath: string }) => {
  return { ok: true, url: pathToFileURL(payload.filePath).toString() };
});

ipcMain.handle("play:loadLog", async (_event, payload: { udpLogPath: string }) => {
  const events = readJsonl(payload.udpLogPath);
  const count = player.load(events);
  return { ok: true, count };
});

ipcMain.handle("play:setTarget", async (_event, payload: { ip: string; port: number }) => {
  const currentSettings = loadAppSettings();
  player.setTarget(payload.ip, payload.port);
  saveAppSettings({
    play: {
      targetIp: payload.ip,
      targetPort: payload.port,
      udpOnly: currentSettings.play?.udpOnly === true
    }
  });
  return { ok: true };
});

ipcMain.handle("play:resetToTime", async (_event, payload: { tSec: number }) => {
  const index = player.resetToTime(payload.tSec);
  return { ok: true, index };
});

ipcMain.handle("play:tick", async (_event, payload: { videoTimeSec: number; offsetMs: number }) => {
  const status = player.tick(payload.videoTimeSec, payload.offsetMs / 1000);
  return { ok: true, status };
});

ipcMain.handle("settings:getAll", async () => {
  const settings = loadAppSettings();
  return { ok: true, settings };
});

ipcMain.handle("settings:savePartial", async (_event, payload: Record<string, unknown>) => {
  const partial: {
    rec?: { udpListenPort: number; forwardTargetIp: string; forwardTargetPort: number };
    play?: { targetIp: string; targetPort: number; udpOnly: boolean };
  } = {};

  if (payload.rec && typeof payload.rec === "object") {
    const rec = payload.rec as {
      udpListenPort?: unknown;
      forwardTargetIp?: unknown;
      forwardTargetPort?: unknown;
    };
    if (
      typeof rec.udpListenPort === "number" &&
      Number.isFinite(rec.udpListenPort) &&
      typeof rec.forwardTargetIp === "string" &&
      rec.forwardTargetIp.length > 0 &&
      typeof rec.forwardTargetPort === "number" &&
      Number.isFinite(rec.forwardTargetPort)
    ) {
      partial.rec = {
        udpListenPort: rec.udpListenPort,
        forwardTargetIp: rec.forwardTargetIp,
        forwardTargetPort: rec.forwardTargetPort
      };
      await applyRelayConfig(partial.rec);
    }
  }
  if (payload.play && typeof payload.play === "object") {
    const play = payload.play as { targetIp?: unknown; targetPort?: unknown; udpOnly?: unknown };
    if (
      typeof play.targetIp === "string" &&
      play.targetIp.length > 0 &&
      typeof play.targetPort === "number" &&
      Number.isFinite(play.targetPort)
    ) {
      partial.play = {
        targetIp: play.targetIp,
        targetPort: play.targetPort,
        udpOnly: play.udpOnly === true
      };
    }
  }

  if (partial.rec || partial.play) {
    saveAppSettings(partial);
  }
  return { ok: true };
});

ipcMain.handle("app:findDefaultMedia", async () => {
  const media = findDefaultMedia();
  return { ok: true, ...media };
});
