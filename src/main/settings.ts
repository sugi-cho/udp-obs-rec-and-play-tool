import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

type PersistedSettings = {
  obs?: {
    url?: string;
    password?: string;
    passwordEncrypted?: boolean;
  };
  rec?: {
    udpListenPort?: number;
  };
  play?: {
    targetIp?: string;
    targetPort?: number;
  };
  updatedAtIso?: string;
};

export type ObsSettings = {
  url: string;
  password: string;
};

export type RecSettings = {
  udpListenPort: number;
};

export type PlaySettings = {
  targetIp: string;
  targetPort: number;
};

export type AppSettings = {
  obs?: ObsSettings;
  rec?: RecSettings;
  play?: PlaySettings;
};

function settingsFilePath(): string {
  return path.join(app.getPath("appData"), "udp-obs-rec-and-play-tool", "settings.json");
}

function decodePassword(value: string, encrypted: boolean): string {
  if (!value) {
    return "";
  }
  if (!encrypted) {
    return value;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function encodePassword(password: string): { value: string; encrypted: boolean } {
  if (!password) {
    return { value: "", encrypted: false };
  }
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password).toString("base64");
    return { value: encrypted, encrypted: true };
  }
  return { value: password, encrypted: false };
}

function readPersistedSettings(): PersistedSettings | null {
  const filePath = settingsFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let json: PersistedSettings;
  try {
    json = JSON.parse(raw) as PersistedSettings;
  } catch {
    return null;
  }

  return json;
}

export function loadAppSettings(): AppSettings {
  const persisted = readPersistedSettings();
  if (!persisted) {
    return {};
  }

  const result: AppSettings = {};

  const url = typeof persisted.obs?.url === "string" ? persisted.obs.url : "";
  const storedPassword = typeof persisted.obs?.password === "string" ? persisted.obs.password : "";
  const encrypted = persisted.obs?.passwordEncrypted === true;
  const password = decodePassword(storedPassword, encrypted);
  if (url || password) {
    result.obs = { url, password };
  }

  const udpListenPort = persisted.rec?.udpListenPort;
  if (typeof udpListenPort === "number" && Number.isFinite(udpListenPort)) {
    result.rec = { udpListenPort };
  }

  const targetIp = persisted.play?.targetIp;
  const targetPort = persisted.play?.targetPort;
  if (
    typeof targetIp === "string" &&
    targetIp.length > 0 &&
    typeof targetPort === "number" &&
    Number.isFinite(targetPort)
  ) {
    result.play = { targetIp, targetPort };
  }

  return result;
}

export function saveAppSettings(partial: Partial<AppSettings>): void {
  const filePath = settingsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const current = readPersistedSettings() ?? {};
  const next: PersistedSettings = {
    ...current
  };

  if (partial.obs) {
    const encodedPassword = encodePassword(partial.obs.password ?? "");
    next.obs = {
      url: partial.obs.url ?? "",
      password: encodedPassword.value,
      passwordEncrypted: encodedPassword.encrypted
    };
  }

  if (partial.rec) {
    next.rec = {
      udpListenPort: partial.rec.udpListenPort
    };
  }

  if (partial.play) {
    next.play = {
      targetIp: partial.play.targetIp,
      targetPort: partial.play.targetPort
    };
  }

  next.updatedAtIso = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
}
