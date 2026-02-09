import OBSWebSocket from "obs-websocket-js";
import type { ObsConfig } from "./types.js";

export class ObsController {
  private obs = new OBSWebSocket();
  private connected = false;
  private lastConfig: ObsConfig | null = null;

  constructor() {
    this.obs.on("ConnectionClosed", () => {
      this.connected = false;
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(config: ObsConfig): Promise<void> {
    if (this.connected) {
      this.lastConfig = config;
      return;
    }
    await this.obs.connect(config.url, config.password);
    this.connected = true;
    this.lastConfig = config;
  }

  async ensureConnected(config?: ObsConfig): Promise<void> {
    if (this.connected) {
      return;
    }
    const cfg = config ?? this.lastConfig;
    if (!cfg) {
      throw new Error("OBS設定がありません。先にConnectしてください。");
    }
    await this.connect(cfg);
  }

  async startRecord(config?: ObsConfig): Promise<void> {
    await this.ensureConnected(config);
    await this.obs.call("StartRecord");
  }

  async stopRecord(): Promise<void> {
    await this.ensureConnected();
    await this.obs.call("StopRecord");
  }
}
