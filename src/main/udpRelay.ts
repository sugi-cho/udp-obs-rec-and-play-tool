import dgram from "node:dgram";

export type RelayConfig = {
  udpListenPort: number;
  forwardTargetIp: string;
  forwardTargetPort: number;
};

export class UdpRelay {
  private listenSocket: dgram.Socket | null = null;
  private forwardSocket: dgram.Socket | null = null;
  private config: RelayConfig | null = null;
  private packetListeners = new Set<(msg: Buffer) => void>();

  getStatus(): { running: boolean; config: RelayConfig | null } {
    return {
      running: this.listenSocket !== null,
      config: this.config
    };
  }

  addPacketListener(listener: (msg: Buffer) => void): () => void {
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  async configure(config: RelayConfig): Promise<void> {
    if (
      this.config &&
      this.listenSocket &&
      this.forwardSocket &&
      this.config.udpListenPort === config.udpListenPort &&
      this.config.forwardTargetIp === config.forwardTargetIp &&
      this.config.forwardTargetPort === config.forwardTargetPort
    ) {
      return;
    }

    await this.stop();

    const listenSocket = dgram.createSocket("udp4");
    const forwardSocket = dgram.createSocket("udp4");

    listenSocket.on("message", (msg) => {
      forwardSocket.send(msg, config.forwardTargetPort, config.forwardTargetIp);
      for (const listener of this.packetListeners) {
        listener(msg);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        listenSocket.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        listenSocket.off("error", onError);
        resolve();
      };
      listenSocket.once("error", onError);
      listenSocket.once("listening", onListening);
      listenSocket.bind(config.udpListenPort);
    });

    this.listenSocket = listenSocket;
    this.forwardSocket = forwardSocket;
    this.config = config;
  }

  async stop(): Promise<void> {
    const listenSocket = this.listenSocket;
    const forwardSocket = this.forwardSocket;
    this.listenSocket = null;
    this.forwardSocket = null;
    this.config = null;

    if (listenSocket) {
      await new Promise<void>((resolve) => {
        listenSocket.close(() => resolve());
      });
    }
    if (forwardSocket) {
      await new Promise<void>((resolve) => {
        forwardSocket.close(() => resolve());
      });
    }
  }
}
