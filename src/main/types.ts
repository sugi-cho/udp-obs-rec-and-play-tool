export type ObsConfig = {
  url: string;
  password: string;
};

export type RecStartRequest = {
  obs: ObsConfig;
  udpListenPort: number;
  outDir: string;
};

export type SessionInfo = {
  sessionDir: string;
  udpLogPath: string;
  metaPath: string;
};

export type UdpLogEvent = {
  t: number;
  data_b64: string;
};
