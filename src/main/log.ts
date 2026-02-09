import fs from "node:fs";
import path from "node:path";
import type { UdpLogEvent } from "./types.js";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createSessionDir(baseOutDir: string): string {
  ensureDir(baseOutDir);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const folderName =
    `session_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const sessionDir = path.join(baseOutDir, folderName);
  ensureDir(sessionDir);
  return sessionDir;
}

export function createJsonlWriter(filePath: string): {
  write: (obj: unknown) => void;
  close: () => Promise<void>;
} {
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  return {
    write: (obj) => {
      stream.write(`${JSON.stringify(obj)}\n`);
    },
    close: () =>
      new Promise<void>((resolve) => {
        stream.end(() => resolve());
      })
  };
}

export function readJsonl(filePath: string): UdpLogEvent[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const events: UdpLogEvent[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Partial<UdpLogEvent>;
      if (typeof obj.t === "number" && typeof obj.data_b64 === "string") {
        events.push({ t: obj.t, data_b64: obj.data_b64 });
      }
    } catch {
      // Ignore malformed lines to keep playback robust.
    }
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}
