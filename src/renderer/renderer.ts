type ApiResult<T extends object = object> = { ok: boolean } & Partial<T>;

declare global {
  interface Window {
    api?: {
      obsConnect(url: string, password: string): Promise<ApiResult>;
      recStart(payload: { obs: { url: string; password: string }; udpListenPort: number; outDir: string }): Promise<
        ApiResult<{ session: { sessionDir: string; udpLogPath: string; metaPath: string } }>
      >;
      recStop(): Promise<ApiResult>;
      getAppSettings(): Promise<
        ApiResult<{
          settings: {
            obs?: { url: string; password: string };
            rec?: { udpListenPort: number };
            play?: { targetIp: string; targetPort: number };
          };
        }>
      >;
      savePartialSettings(payload: {
        rec?: { udpListenPort: number };
        play?: { targetIp: string; targetPort: number };
      }): Promise<ApiResult>;
      findDefaultMedia(): Promise<
        ApiResult<{
          found: boolean;
          directory: string | null;
          mp4Path: string | null;
          logPath: string | null;
        }>
      >;
      recStatus(): Promise<
        ApiResult<{
          obsConnected: boolean;
          recording: boolean;
          packetCount: number;
          session: { sessionDir: string; udpLogPath: string; metaPath: string } | null;
          recentPackets: {
            seq: number;
            t: number;
            size: number;
            data_b64: string;
            osc: {
              ok: boolean;
              kind: "message" | "bundle" | "unknown";
              text: string;
              address?: string;
              typeTags?: string;
              args?: string[];
            };
          }[];
        }>
      >;

      openFile(filters: { name: string; extensions: string[] }[]): Promise<ApiResult<{ path: string }>>;
      openDirectory(): Promise<ApiResult<{ path: string }>>;
      pathToFileUrl(filePath: string): Promise<ApiResult<{ url: string }>>;

      playLoadLog(udpLogPath: string): Promise<ApiResult<{ count: number }>>;
      playSetTarget(ip: string, port: number): Promise<ApiResult>;
      playResetToTime(tSec: number): Promise<ApiResult<{ index: number }>>;
      playTick(videoTimeSec: number, offsetMs: number): Promise<
        ApiResult<{
          status: {
            sentIndex: number;
            total: number;
            recentSent: {
              seq: number;
              t: number;
              size: number;
              data_b64: string;
              osc: {
                ok: boolean;
                kind: "message" | "bundle" | "unknown";
                text: string;
              };
            }[];
          };
        }>
      >;
    };
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element not found: ${id}`);
  }
  return el as T;
}

const API_MISSING_MESSAGE =
  "Electron APIが見つかりません。ブラウザではなくElectronアプリとして起動してください（npm run dev）。";

function getApi(): NonNullable<Window["api"]> {
  if (!window.api) {
    throw new Error(API_MISSING_MESSAGE);
  }
  return window.api;
}

type StatusItem = {
  label: string;
  value: string | number | boolean;
};

function renderStatusLine(container: HTMLElement, items: StatusItem[]): void {
  container.replaceChildren();
  for (const item of items) {
    const row = document.createElement("span");
    row.className = "status-item";

    const label = document.createElement("span");
    label.className = "status-label";
    label.textContent = `${item.label}:`;
    row.appendChild(label);

    if (typeof item.value === "boolean") {
      const bool = document.createElement("span");
      bool.className = `status-bool ${item.value ? "on" : "off"}`;
      bool.textContent = "●";
      row.appendChild(bool);

      const text = document.createElement("span");
      text.textContent = item.value ? "true" : "false";
      row.appendChild(text);
    } else {
      const value = document.createElement("span");
      value.textContent = String(item.value);
      row.appendChild(value);
    }

    container.appendChild(row);
  }
}

function setStatusNote(container: HTMLElement, text: string, isError = false): void {
  container.textContent = text;
  container.classList.toggle("error", isError);
}

const tabRec = byId<HTMLButtonElement>("tab-rec");
const tabPlay = byId<HTMLButtonElement>("tab-play");
const viewRec = byId<HTMLElement>("view-rec");
const viewPlay = byId<HTMLElement>("view-play");

function showTab(tab: "rec" | "play"): void {
  const recActive = tab === "rec";
  tabRec.classList.toggle("active", recActive);
  tabPlay.classList.toggle("active", !recActive);
  viewRec.classList.toggle("active", recActive);
  viewPlay.classList.toggle("active", !recActive);
}

tabRec.addEventListener("click", () => showTab("rec"));
tabPlay.addEventListener("click", () => showTab("play"));
showTab("play");

const obsUrlInput = byId<HTMLInputElement>("obs-url");
const obsPasswordInput = byId<HTMLInputElement>("obs-password");
const udpListenPortInput = byId<HTMLInputElement>("udp-listen-port");
const outputDirInput = byId<HTMLInputElement>("output-dir");
const recBasicStatus = byId<HTMLDivElement>("rec-basic-status");
const recPacketList = byId<HTMLDivElement>("rec-packet-list");
const recNote = byId<HTMLDivElement>("rec-note");

const connectObsButton = byId<HTMLButtonElement>("connect-obs");
const chooseOutputDirButton = byId<HTMLButtonElement>("choose-output-dir");
const recStartButton = byId<HTMLButtonElement>("rec-start");
const recStopButton = byId<HTMLButtonElement>("rec-stop");

let recPollTimer: number | null = null;

function renderRecPacketRows(
  packets: {
    seq: number;
    t: number;
    size: number;
    osc: { text: string };
  }[]
): void {
  const newestFirst = [...packets].reverse();
  recPacketList.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const line = document.createElement("div");
    line.className = "packet-line";
    const packet = newestFirst[i];
    if (!packet) {
      line.textContent = `${i + 1}. -`;
    } else {
      line.textContent = `${packet.seq}. t=${packet.t.toFixed(3)}s | ${packet.size}B | ${packet.osc.text || "raw"}`;
    }
    recPacketList.appendChild(line);
  }
}

async function refreshRecStatus(): Promise<void> {
  try {
    const status = await getApi().recStatus();
    renderStatusLine(recBasicStatus, [
      { label: "OBS", value: Boolean(status.obsConnected) },
      { label: "REC", value: Boolean(status.recording) },
      { label: "Packets", value: status.packetCount ?? 0 },
      { label: "Log", value: status.session?.udpLogPath ?? "-" }
    ]);

    renderRecPacketRows(status.recentPackets ?? []);
  } catch (error) {
    renderRecPacketRows([]);
    setStatusNote(recNote, `REC status error: ${(error as Error).message}`, true);
  }
}

connectObsButton.addEventListener("click", async () => {
  try {
    await getApi().obsConnect(obsUrlInput.value, obsPasswordInput.value);
    setStatusNote(recNote, "OBS connected.", false);
    await refreshRecStatus();
  } catch (error) {
    setStatusNote(recNote, `OBS connect error: ${(error as Error).message}`, true);
  }
});

chooseOutputDirButton.addEventListener("click", async () => {
  const result = await getApi().openDirectory();
  if (result.ok && result.path) {
    outputDirInput.value = result.path;
  }
});

recStartButton.addEventListener("click", async () => {
  try {
    const payload = {
      obs: { url: obsUrlInput.value, password: obsPasswordInput.value },
      udpListenPort: Number(udpListenPortInput.value),
      outDir: outputDirInput.value
    };
    const result = await getApi().recStart(payload);
    setStatusNote(recNote, `REC started: ${result.session?.udpLogPath ?? "-"}`, false);
    await refreshRecStatus();
    if (recPollTimer === null) {
      recPollTimer = window.setInterval(() => {
        void refreshRecStatus();
      }, 500);
    }
  } catch (error) {
    setStatusNote(recNote, `REC START error: ${(error as Error).message}`, true);
  }
});

recStopButton.addEventListener("click", async () => {
  try {
    await getApi().recStop();
    if (recPollTimer !== null) {
      window.clearInterval(recPollTimer);
      recPollTimer = null;
    }
    await refreshRecStatus();
    setStatusNote(recNote, "REC stopped.", false);
  } catch (error) {
    setStatusNote(recNote, `REC STOP error: ${(error as Error).message}`, true);
  }
});

const chooseMp4Button = byId<HTMLButtonElement>("choose-mp4");
const chooseLogButton = byId<HTMLButtonElement>("choose-log");
const mp4PathInput = byId<HTMLInputElement>("mp4-path");
const udpLogPathInput = byId<HTMLInputElement>("udp-log-path");
const targetIpInput = byId<HTMLInputElement>("target-ip");
const targetPortInput = byId<HTMLInputElement>("target-port");
const offsetInput = byId<HTMLInputElement>("offset-ms");
const offsetValue = byId<HTMLSpanElement>("offset-value");
const preloadButton = byId<HTMLButtonElement>("preload");
const playButton = byId<HTMLButtonElement>("play");
const pauseButton = byId<HTMLButtonElement>("pause");
const stopButton = byId<HTMLButtonElement>("stop");
const playLoopToggle = byId<HTMLInputElement>("play-loop-toggle");
const video = byId<HTMLVideoElement>("video");
const playBasicStatus = byId<HTMLDivElement>("play-basic-status");
const playPacketList = byId<HTMLDivElement>("play-packet-list");
const playNote = byId<HTMLDivElement>("play-note");

let preloaded = false;
let tickTimer: number | null = null;
let lastSentIndex = 0;
let lastTotal = 0;
let recentSentPackets: { seq: number; t: number; size: number; osc: { text: string } }[] = [];

function stopTickLoop(): void {
  if (tickTimer !== null) {
    window.clearTimeout(tickTimer);
    tickTimer = null;
  }
}

function offsetMs(): number {
  return Number(offsetInput.value);
}

function renderPlayPacketRows(
  packets: {
    seq: number;
    t: number;
    size: number;
    osc: { text: string };
  }[]
): void {
  const newestFirst = [...packets].reverse();
  playPacketList.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const line = document.createElement("div");
    line.className = "packet-line";
    const packet = newestFirst[i];
    if (!packet) {
      line.textContent = `${i + 1}. -`;
    } else {
      line.textContent = `${packet.seq}. t=${packet.t.toFixed(3)}s | ${packet.size}B | ${packet.osc.text || "raw"}`;
    }
    playPacketList.appendChild(line);
  }
}

function showPlayStatus(note?: { text: string; error?: boolean }): void {
  renderStatusLine(playBasicStatus, [
    { label: "Ready", value: preloaded },
    { label: "Time", value: `${video.currentTime.toFixed(3)}s` },
    { label: "Sent", value: `${lastSentIndex}/${lastTotal}` },
    { label: "Offset", value: `${offsetMs()}ms` },
    { label: "Loop", value: playLoopToggle.checked }
  ]);
  renderPlayPacketRows(recentSentPackets);
  if (note) {
    setStatusNote(playNote, note.text, Boolean(note.error));
  }
}

async function tickOnce(): Promise<void> {
  if (video.paused) {
    stopTickLoop();
    return;
  }
  try {
    const res = await getApi().playTick(video.currentTime, offsetMs());
    lastSentIndex = res.status?.sentIndex ?? lastSentIndex;
    lastTotal = res.status?.total ?? lastTotal;
    recentSentPackets = res.status?.recentSent ?? recentSentPackets;
    showPlayStatus();
  } catch (error) {
    showPlayStatus({ text: (error as Error).message, error: true });
    stopTickLoop();
    return;
  }
  tickTimer = window.setTimeout(() => {
    void tickOnce();
  }, 15);
}

function waitForPlayingEvent(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onPlaying = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画再生開始に失敗しました。"));
    };
    const cleanup = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function startSyncLoop(): void {
  stopTickLoop();
  void tickOnce();
}

async function startSynchronizedPlayFromCurrentTime(): Promise<void> {
  if (!preloaded) {
    throw new Error("先にPRELOADを実行してください。");
  }

  await getApi().playSetTarget(targetIpInput.value, Number(targetPortInput.value));

  const startTime = video.currentTime + offsetMs() / 1000;
  const resetResult = await getApi().playResetToTime(startTime);
  lastSentIndex = resetResult.index ?? 0;
  recentSentPackets = [];

  const playingEvent = waitForPlayingEvent();
  await video.play();
  await playingEvent;
  startSyncLoop();
}

offsetInput.addEventListener("input", () => {
  offsetValue.textContent = offsetInput.value;
  showPlayStatus();
});

playLoopToggle.addEventListener("change", () => {
  showPlayStatus({ text: playLoopToggle.checked ? "Loop ON" : "Loop OFF" });
});

udpListenPortInput.addEventListener("change", async () => {
  const port = Number(udpListenPortInput.value);
  if (!Number.isFinite(port)) {
    return;
  }
  await getApi().savePartialSettings({ rec: { udpListenPort: port } });
});

targetIpInput.addEventListener("change", async () => {
  const port = Number(targetPortInput.value);
  if (!targetIpInput.value || !Number.isFinite(port)) {
    return;
  }
  await getApi().savePartialSettings({
    play: { targetIp: targetIpInput.value, targetPort: port }
  });
});

targetPortInput.addEventListener("change", async () => {
  const port = Number(targetPortInput.value);
  if (!targetIpInput.value || !Number.isFinite(port)) {
    return;
  }
  await getApi().savePartialSettings({
    play: { targetIp: targetIpInput.value, targetPort: port }
  });
});

chooseMp4Button.addEventListener("click", async () => {
  const result = await getApi().openFile([{ name: "MP4", extensions: ["mp4"] }]);
  if (result.ok && result.path) {
    mp4PathInput.value = result.path;
  }
});

chooseLogButton.addEventListener("click", async () => {
  const result = await getApi().openFile([{ name: "JSONL", extensions: ["jsonl"] }]);
  if (result.ok && result.path) {
    udpLogPathInput.value = result.path;
  }
});

preloadButton.addEventListener("click", async () => {
  await preloadSelectedMedia();
});

async function preloadSelectedMedia(): Promise<void> {
  try {
    if (!mp4PathInput.value) {
      throw new Error("MP4ファイルを選択してください。");
    }
    if (!udpLogPathInput.value) {
      throw new Error("udp.jsonlファイルを選択してください。");
    }

    const loadRes = await getApi().playLoadLog(udpLogPathInput.value);
    lastTotal = loadRes.count ?? 0;
    await getApi().playResetToTime(0);
    lastSentIndex = 0;
    recentSentPackets = [];

    const urlRes = await getApi().pathToFileUrl(mp4PathInput.value);
    const videoUrl = urlRes.url;
    if (!urlRes.ok || !videoUrl) {
      throw new Error("MP4ファイルURLの生成に失敗しました。");
    }

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("動画の読み込みに失敗しました。"));
      };
      const cleanup = () => {
        video.removeEventListener("canplaythrough", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("canplaythrough", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = videoUrl;
      video.load();
    });

    preloaded = true;
    showPlayStatus({ text: "Ready" });
  } catch (error) {
    preloaded = false;
    showPlayStatus({ text: (error as Error).message, error: true });
  }
}

playButton.addEventListener("click", async () => {
  try {
    await startSynchronizedPlayFromCurrentTime();
    showPlayStatus({ text: "Playing" });
  } catch (error) {
    showPlayStatus({ text: (error as Error).message, error: true });
  }
});

pauseButton.addEventListener("click", () => {
  video.pause();
  stopTickLoop();
  showPlayStatus({ text: "Paused" });
});

stopButton.addEventListener("click", async () => {
  video.pause();
  stopTickLoop();
  video.currentTime = 0;
  await getApi().playResetToTime(0);
  lastSentIndex = 0;
  recentSentPackets = [];
  showPlayStatus({ text: "Stopped" });
});

video.addEventListener("seeking", () => {
  stopTickLoop();
});

video.addEventListener("seeked", async () => {
  if (!preloaded) {
    return;
  }
  const seekTime = video.currentTime + offsetMs() / 1000;
  const resetResult = await getApi().playResetToTime(seekTime);
  lastSentIndex = resetResult.index ?? lastSentIndex;
  if (!video.paused) {
    void tickOnce();
  }
});

video.addEventListener("ended", async () => {
  stopTickLoop();
  if (playLoopToggle.checked) {
    try {
      video.currentTime = 0;
      await startSynchronizedPlayFromCurrentTime();
      showPlayStatus({ text: "Looping" });
      return;
    } catch (error) {
      showPlayStatus({ text: `Loop error: ${(error as Error).message}`, error: true });
      return;
    }
  }
  const resetResult = await getApi().playResetToTime(0);
  lastSentIndex = resetResult.index ?? 0;
  recentSentPackets = [];
  showPlayStatus({ text: "Ended" });
});

video.addEventListener("click", (e) => e.preventDefault());
video.addEventListener("dblclick", (e) => e.preventDefault());
video.addEventListener("contextmenu", (e) => e.preventDefault());

renderStatusLine(recBasicStatus, [
  { label: "OBS", value: false },
  { label: "REC", value: false },
  { label: "Packets", value: 0 },
  { label: "Log", value: "-" }
]);
renderRecPacketRows([]);
setStatusNote(recNote, " ", false);
setStatusNote(playNote, " ", false);

if (!window.api) {
  const unavailableButtons = [
    connectObsButton,
    chooseOutputDirButton,
    recStartButton,
    recStopButton,
    chooseMp4Button,
    chooseLogButton,
    preloadButton,
    playButton,
    pauseButton,
    stopButton
  ];
  for (const button of unavailableButtons) {
    button.disabled = true;
  }
  setStatusNote(recNote, API_MISSING_MESSAGE, true);
  showPlayStatus({ text: API_MISSING_MESSAGE, error: true });
} else {
  void (async () => {
    try {
      const appSettingsRes = await getApi().getAppSettings();
      if (appSettingsRes.ok && appSettingsRes.settings) {
        if (appSettingsRes.settings.obs?.url) {
          obsUrlInput.value = appSettingsRes.settings.obs.url;
        }
        if (appSettingsRes.settings.obs?.password) {
          obsPasswordInput.value = appSettingsRes.settings.obs.password;
          try {
            await getApi().obsConnect(obsUrlInput.value, obsPasswordInput.value);
            setStatusNote(recNote, "保存済み設定でOBSへ自動接続しました。", false);
          } catch (error) {
            setStatusNote(recNote, `OBS自動接続に失敗: ${(error as Error).message}`, true);
          }
        }
        if (typeof appSettingsRes.settings.rec?.udpListenPort === "number") {
          udpListenPortInput.value = String(appSettingsRes.settings.rec.udpListenPort);
        }
        if (appSettingsRes.settings.play?.targetIp) {
          targetIpInput.value = appSettingsRes.settings.play.targetIp;
        }
        if (typeof appSettingsRes.settings.play?.targetPort === "number") {
          targetPortInput.value = String(appSettingsRes.settings.play.targetPort);
        }
      }

      const defaultMediaRes = await getApi().findDefaultMedia();
      if (defaultMediaRes.ok && defaultMediaRes.found && defaultMediaRes.mp4Path && defaultMediaRes.logPath) {
        mp4PathInput.value = defaultMediaRes.mp4Path;
        udpLogPathInput.value = defaultMediaRes.logPath;
        await preloadSelectedMedia();
      }
    } catch {
      // Keep UI defaults when settings load fails.
    }
    await refreshRecStatus();
    showPlayStatus();
  })();
}

export {};
