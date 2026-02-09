import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import { createJsonlWriter, createSessionDir } from "./log.js";
import { parseOscPreview, type OscPreview } from "./oscPreview.js";
import type { SessionInfo } from "./types.js";

type Writer = ReturnType<typeof createJsonlWriter>;
type RecentPacket = {
  seq: number;
  t: number;
  size: number;
  data_b64: string;
  osc: OscPreview;
};
const MAX_RECENT_PACKETS = 4;

function monotonicNowSec(): number {
  return Number(process.hrtime.bigint()) / 1e9;
}

export class UdpRecorder {
  private socket: dgram.Socket | null = null;
  private writer: Writer | null = null;
  private packetCount = 0;
  private t0 = 0;
  private session: SessionInfo | null = null;
  private recentPackets: RecentPacket[] = [];

  getStatus(): {
    running: boolean;
    packetCount: number;
    session: SessionInfo | null;
    recentPackets: RecentPacket[];
  } {
    return {
      running: this.socket !== null,
      packetCount: this.packetCount,
      session: this.session,
      recentPackets: [...this.recentPackets]
    };
  }

  async start(params: {
    outDir: string;
    udpListenPort: number;
    t0Sec: number;
    meta: Record<string, unknown>;
  }): Promise<SessionInfo> {
    if (this.socket) {
      throw new Error("UDP記録はすでに開始しています。");
    }

    const sessionDir = createSessionDir(params.outDir);
    const udpLogPath = path.join(sessionDir, "udp.jsonl");
    const metaPath = path.join(sessionDir, "meta.json");
    const session: SessionInfo = { sessionDir, udpLogPath, metaPath };

    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          createdAtIso: new Date().toISOString(),
          ...params.meta
        },
        null,
        2
      ),
      "utf-8"
    );

    const socket = dgram.createSocket("udp4");
    const writer = createJsonlWriter(udpLogPath);
    this.socket = socket;
    this.writer = writer;
    this.packetCount = 0;
    this.t0 = params.t0Sec;
    this.session = session;
    this.recentPackets = [];

    socket.on("message", (msg) => {
      const t = monotonicNowSec() - this.t0;
      const data_b64 = msg.toString("base64");
      const osc = parseOscPreview(msg);
      this.packetCount += 1;
      writer.write({ t, data_b64 });

      this.recentPackets.push({
        seq: this.packetCount,
        t,
        size: msg.length,
        data_b64,
        osc
      });
      if (this.recentPackets.length > MAX_RECENT_PACKETS) {
        this.recentPackets.shift();
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        socket.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(params.udpListenPort);
    });

    return session;
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    const writer = this.writer;
    this.socket = null;
    this.writer = null;
    this.recentPackets = [];

    if (socket) {
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    }
    if (writer) {
      await writer.close();
    }
  }
}
