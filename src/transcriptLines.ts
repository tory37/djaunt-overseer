import * as fs from "fs";

const NEWLINE_BYTE = 0x0a;

export interface TranscriptLine {
  line: string;
  endOffsetBytes: number;
}

export async function* readCompleteLines(
  file: string,
  startOffsetBytes: number,
): AsyncGenerator<TranscriptLine> {
  let partialLineChunks: Buffer[] = [];
  let chunkStartOffsetBytes = startOffsetBytes;
  for await (const chunk of fs.createReadStream(file, { start: startOffsetBytes })) {
    const chunkBuffer = chunk as Buffer;
    let sliceStart = 0;
    let newlineIndex = chunkBuffer.indexOf(NEWLINE_BYTE, sliceStart);
    while (newlineIndex !== -1) {
      partialLineChunks.push(chunkBuffer.subarray(sliceStart, newlineIndex));
      const lineBuffer = Buffer.concat(partialLineChunks);
      const endOffsetBytes = chunkStartOffsetBytes + newlineIndex + 1;
      partialLineChunks = [];
      if (lineBuffer.length > 0) {
        yield { line: lineBuffer.toString("utf8"), endOffsetBytes };
      }
      sliceStart = newlineIndex + 1;
      newlineIndex = chunkBuffer.indexOf(NEWLINE_BYTE, sliceStart);
    }
    partialLineChunks.push(chunkBuffer.subarray(sliceStart));
    chunkStartOffsetBytes += chunkBuffer.length;
  }
}

// Reads back from a known line end, so one earlier line is found without reading the transcript from the start.
// A line longer than maxBytes comes back undefined.
export async function readLineEndingAt(file: string, endOffsetBytes: number, maxBytes: number): Promise<string | undefined> {
  const startOffsetBytes = Math.max(0, endOffsetBytes - maxBytes);
  let fileHandle: fs.promises.FileHandle | undefined;
  try {
    fileHandle = await fs.promises.open(file, "r");
    const windowBuffer = Buffer.alloc(endOffsetBytes - startOffsetBytes);
    const { bytesRead } = await fileHandle.read(windowBuffer, 0, windowBuffer.length, startOffsetBytes);
    const lineBuffer = windowBuffer.subarray(0, bytesRead);
    const contentEnd = lineBuffer[lineBuffer.length - 1] === NEWLINE_BYTE ? lineBuffer.length - 1 : lineBuffer.length;
    if (contentEnd <= 0) {
      return undefined;
    }
    const previousNewlineIndex = lineBuffer.lastIndexOf(NEWLINE_BYTE, contentEnd - 1);
    if (previousNewlineIndex === -1 && startOffsetBytes > 0) {
      return undefined;
    }
    return lineBuffer.subarray(previousNewlineIndex + 1, contentEnd).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}
