export interface DetectResult {
  encoding: string;
  delimiter: string;
}

const DELIMITERS = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Max bytes to sample for encoding detection — 4KB is more than enough */
const ENCODING_SAMPLE_SIZE = 4096;

/**
 * Ultra-lightweight, zero-dependency character encoding detector.
 * Eliminates massive jschardet CJK distribution matrices (saving ~250KB).
 */
export function detectEncoding(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

  const sample = bytes.subarray(0, Math.min(bytes.length, ENCODING_SAMPLE_SIZE));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

export function detectDelimiter(text: string): Delimiter {
  // Find the end of the 10th line without splitting the entire string
  let pos = 0;
  for (let n = 0; n < 10 && pos < text.length; n++) {
    const next = text.indexOf("\n", pos);
    if (next === -1) { pos = text.length; break; }
    pos = next + 1;
  }
  const lines = text.substring(0, pos).split("\n");

  let best: Delimiter = ",";
  let bestScore = 0;

  for (const d of DELIMITERS) {
    const counts = lines
      .filter((l) => l.trim().length > 0)
      .map((l) => l.split(d).length - 1);
    if (counts.length === 0) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((a, c) => a + (c - avg) ** 2, 0) / counts.length;
    const score = avg > 0 ? avg / (1 + variance) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function detect(buffer: ArrayBuffer): DetectResult {
  const encoding = detectEncoding(buffer);
  const decoder = new TextDecoder(encoding);
  const text = decoder.decode(buffer);
  const delimiter = detectDelimiter(text);
  return { encoding, delimiter };
}
