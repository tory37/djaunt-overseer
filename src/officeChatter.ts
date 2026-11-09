// Pure: how the Office shows what the guys say, so a chatty room doesn't bury the pixel art.
// bubbles: every line in a bubble over its speaker, as before.
// tidy: a few bubbles at once; the rest show a small "..." pip over the speaker until a slot frees up. When there's
// free space above the room, lines that didn't get a bubble go to the chat log there instead of waiting.
// log: lines go to a chat log above the room, newest at the bottom, and fade; the room shows pips.
// quiet: pips only.
// In every style, hovering a guy shows his line, and lines that must be seen (your event lines, a show's act) stay
// in bubbles.

export type ChatterStyle = "bubbles" | "tidy" | "log" | "quiet";

export const CHATTER_STYLES: readonly ChatterStyle[] = ["bubbles", "tidy", "log", "quiet"];

export const CHATTER_LABELS: Record<ChatterStyle, { label: string; description: string }> = {
  bubbles: { label: "Bubbles", description: "every line in a bubble" },
  tidy: { label: "Tidy", description: "a few bubbles at once, the rest as pips (and in a log when there's room above)" },
  log: { label: "Chat Log", description: "lines in a log above the room, pips in it" },
  quiet: { label: "Quiet", description: "pips only, hover a guy to read" },
};

export function chatterStyle(value: unknown): ChatterStyle {
  return CHATTER_STYLES.includes(value as ChatterStyle) ? (value as ChatterStyle) : "tidy";
}

// How a line ranks for a bubble. "must": always a bubble. "high": you and visitors go first. "normal": the rest.
export type ChatPriority = "must" | "high" | "normal";

export interface ChatLine {
  id: string;
  text: string;
  // When the line was first seen and when it ends.
  since: number;
  until: number;
  priority: ChatPriority;
}

export interface ChatLayout {
  // Lines in a full bubble over the speaker.
  full: Set<string>;
  // Lines shown as a pip over the speaker.
  pips: Set<string>;
}

// Bubbles at once in tidy: about one per four tiles across, at least two.
export function bubbleLimit(cols: number): number {
  return Math.max(2, Math.round(cols / 4));
}

// A pip line is promoted to a bubble only if there is time left to read it.
const PROMOTE_SECONDS = 1.2;

const RANK: Record<ChatPriority, number> = { must: 2, high: 1, normal: 0 };

// Which lines get a bubble this frame. `shown` is last frame's full set: a bubble keeps its slot until its line
// ends, so nothing collapses mid-read.
export function layoutChatter(
  lines: readonly ChatLine[],
  style: ChatterStyle,
  shown: ReadonlySet<string>,
  limit: number,
  time: number,
  hoveredId?: string,
  // Lines already sent to the chat log: they stay pips.
  logged: ReadonlySet<string> = new Set(),
): ChatLayout {
  const full = new Set<string>();
  const pips = new Set<string>();
  if (style === "bubbles") {
    lines.forEach((line) => full.add(line.id));
    return { full, pips };
  }
  const always = (line: ChatLine) => line.priority === "must" || line.id === hoveredId;
  lines.filter(always).forEach((line) => full.add(line.id));
  if (style === "tidy") {
    lines.filter((line) => !full.has(line.id) && shown.has(line.id)).forEach((line) => full.add(line.id));
    const waiting = lines
      .filter((line) => !full.has(line.id) && !logged.has(line.id) && line.until - time >= PROMOTE_SECONDS)
      .sort((first, second) => RANK[second.priority] - RANK[first.priority] || first.since - second.since);
    for (const line of waiting) {
      if (full.size >= limit) {
        break;
      }
      full.add(line.id);
    }
  }
  lines.filter((line) => !full.has(line.id)).forEach((line) => pips.add(line.id));
  return { full, pips };
}

// Whether the chat log shows: always in log, in tidy only when there's free space above the room for it.
export function showsChatLog(style: ChatterStyle, roomAbove: boolean): boolean {
  return style === "log" || (style === "tidy" && roomAbove);
}

// A line in the chat log.
export interface ChatLogEntry {
  id: string;
  text: string;
  at: number;
}

export const LOG_KEEP = 40;
const LOG_SHOW_SECONDS = 9;
const LOG_FADE_SECONDS = 2;

// Adds a line, keeping the newest LOG_KEEP. The same speaker saying the same thing back to back is one line.
export function pushChatLog(log: readonly ChatLogEntry[], entry: ChatLogEntry): ChatLogEntry[] {
  const last = log[log.length - 1];
  if (last !== undefined && last.id === entry.id && last.text === entry.text && entry.at - last.at < LOG_SHOW_SECONDS) {
    return [...log];
  }
  return [...log, entry].slice(-LOG_KEEP);
}

// The log lines to draw now, oldest first, each with its opacity: shown for a while, then fading out.
export function visibleChatLog(log: readonly ChatLogEntry[], time: number, max: number): { entry: ChatLogEntry; alpha: number }[] {
  return log
    .filter((entry) => time - entry.at < LOG_SHOW_SECONDS)
    .slice(-max)
    .map((entry) => {
      const age = time - entry.at;
      const fadeFrom = LOG_SHOW_SECONDS - LOG_FADE_SECONDS;
      return { entry, alpha: age <= fadeFrom ? 1 : Math.max(0, (LOG_SHOW_SECONDS - age) / LOG_FADE_SECONDS) };
    });
}

// A bubble's opacity: a quick fade in, and a fade out over its last moments.
export function bubbleAlpha(since: number, until: number, time: number): number {
  return Math.max(0, Math.min(1, (time - since) / 0.15, (until - time) / 0.3));
}

// How often the guys talk on their own: chats, mutters while typing, and musings while idle. Visitors, shows,
// events, and critters keep their own lines.
export type TalkFrequency = "off" | "rare" | "normal" | "often";

export const TALK_FREQUENCIES: readonly TalkFrequency[] = ["off", "rare", "normal", "often"];

export function talkFrequency(value: unknown): TalkFrequency {
  return TALK_FREQUENCIES.includes(value as TalkFrequency) ? (value as TalkFrequency) : "normal";
}

// The sim's talk factor: scales how likely a guy starts a chat or says something to nobody, and slows a chat's lines
// when below 1.
export function talkFactor(frequency: TalkFrequency): number {
  return { off: 0, rare: 0.35, normal: 1, often: 2 }[frequency];
}
