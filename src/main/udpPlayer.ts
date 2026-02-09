import dgram from "node:dgram";
import { parseOscPreview, type OscPreview } from "./oscPreview.js";
import type { UdpLogEvent } from "./types.js";

type RecentSentPacket = {
  seq: number;
  t: number;
  size: number;
  data_b64: string;
  osc: OscPreview;
};
const MAX_RECENT_SENT = 4;

export class UdpPlayer {
  private socket = dgram.createSocket("udp4");
  private events: UdpLogEvent[] = [];
  private index = 0;
  private targetIp = "127.0.0.1";
  private targetPort = 5005;
  private recentSent: RecentSentPacket[] = [];

  load(events: UdpLogEvent[]): number {
    this.events = events;
    this.index = 0;
    this.recentSent = [];
    return this.events.length;
  }

  setTarget(targetIp: string, targetPort: number): void {
    this.targetIp = targetIp;
    this.targetPort = targetPort;
  }

  resetToTime(timeSec: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t < timeSec) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.index = lo;
    this.recentSent = [];
    return this.index;
  }

  tick(videoTimeSec: number, offsetSec: number): {
    sentIndex: number;
    total: number;
    recentSent: RecentSentPacket[];
  } {
    const targetTime = videoTimeSec + offsetSec;
    while (this.index < this.events.length && this.events[this.index].t <= targetTime) {
      const ev = this.events[this.index];
      const data = Buffer.from(ev.data_b64, "base64");
      this.socket.send(data, this.targetPort, this.targetIp);
      this.recentSent.push({
        seq: this.index + 1,
        t: ev.t,
        size: data.length,
        data_b64: ev.data_b64,
        osc: parseOscPreview(data)
      });
      if (this.recentSent.length > MAX_RECENT_SENT) {
        this.recentSent.shift();
      }
      this.index += 1;
    }
    return {
      sentIndex: this.index,
      total: this.events.length,
      recentSent: [...this.recentSent]
    };
  }
}
