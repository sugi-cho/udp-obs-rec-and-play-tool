export type OscPreview = {
  ok: boolean;
  kind: "message" | "bundle" | "unknown";
  text: string;
  address?: string;
  typeTags?: string;
  args?: string[];
};

function roundTo4(n: number): number {
  return (n + 3) & ~3;
}

function readOscString(buf: Buffer, offset: number): { value: string; next: number } {
  const end = buf.indexOf(0, offset);
  if (end < 0) {
    throw new Error("OSC string terminator not found");
  }
  const value = buf.subarray(offset, end).toString("utf-8");
  return { value, next: roundTo4(end + 1) };
}

function truncateText(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function parseOscMessage(buf: Buffer): OscPreview {
  let offset = 0;
  const addressResult = readOscString(buf, offset);
  const address = addressResult.value;
  offset = addressResult.next;
  const tagResult = readOscString(buf, offset);
  const typeTags = tagResult.value;
  offset = tagResult.next;

  if (!address.startsWith("/")) {
    throw new Error("Not an OSC message address");
  }
  if (!typeTags.startsWith(",")) {
    throw new Error("Invalid OSC typetag");
  }

  const args: string[] = [];
  for (let i = 1; i < typeTags.length; i += 1) {
    const t = typeTags[i];
    if (t === "i") {
      if (offset + 4 > buf.length) throw new Error("int32 out of bounds");
      args.push(String(buf.readInt32BE(offset)));
      offset += 4;
      continue;
    }
    if (t === "f") {
      if (offset + 4 > buf.length) throw new Error("float32 out of bounds");
      args.push(String(Number(buf.readFloatBE(offset).toFixed(6))));
      offset += 4;
      continue;
    }
    if (t === "s") {
      const s = readOscString(buf, offset);
      args.push(`"${truncateText(s.value)}"`);
      offset = s.next;
      continue;
    }
    if (t === "b") {
      if (offset + 4 > buf.length) throw new Error("blob length out of bounds");
      const blobLen = buf.readInt32BE(offset);
      offset += 4;
      if (offset + blobLen > buf.length) throw new Error("blob out of bounds");
      args.push(`blob(${blobLen})`);
      offset = roundTo4(offset + blobLen);
      continue;
    }
    if (t === "T") {
      args.push("true");
      continue;
    }
    if (t === "F") {
      args.push("false");
      continue;
    }
    if (t === "N") {
      args.push("nil");
      continue;
    }
    if (t === "I") {
      args.push("inf");
      continue;
    }
    args.push(`?(${t})`);
  }

  return {
    ok: true,
    kind: "message",
    text: `${address} ${args.join(" ")}`.trim(),
    address,
    typeTags,
    args
  };
}

export function parseOscPreview(buf: Buffer): OscPreview {
  try {
    if (buf.length === 0) {
      return { ok: false, kind: "unknown", text: "empty packet" };
    }
    if (buf.subarray(0, 8).toString("utf-8") === "#bundle\u0000") {
      if (buf.length < 16) {
        throw new Error("bundle too short");
      }
      let offset = 16;
      let elementCount = 0;
      const heads: string[] = [];
      while (offset + 4 <= buf.length) {
        const size = buf.readInt32BE(offset);
        offset += 4;
        if (size <= 0 || offset + size > buf.length) break;
        elementCount += 1;
        const child = buf.subarray(offset, offset + size);
        const childPreview = parseOscPreview(child);
        if (heads.length < 3) {
          heads.push(childPreview.address ?? childPreview.text);
        }
        offset += size;
      }
      return {
        ok: true,
        kind: "bundle",
        text: `#bundle elements=${elementCount}${heads.length ? ` [${heads.join(", ")}]` : ""}`,
        args: heads
      };
    }
    return parseOscMessage(buf);
  } catch (error) {
    return {
      ok: false,
      kind: "unknown",
      text: `raw (${(error as Error).message})`
    };
  }
}

