// Pure: the Office view's people. Each live session gets a guy with a desk. A working session's guy sits at his desk
// and types; an idle one sits back, then wanders off: the cooler, the coffee, the couch, a walk, or a chat with
// another idle guy. When his session gets busy again he runs back to his desk. A suspended session's guy goes back to
// his desk and falls asleep on it. A session that leaves the sidebar walks out the door.
// You're in the room too, at your station: you work, take a break now and then to wander, grab a coffee, or shoot
// the breeze with someone (idle, or busy at his desk), and run back to your desk when a scene event hits.
// Now and then someone from another department visits: walks in and says his lines to the room. Some walk right back
// out; others hang around like an idle guy (chats, coffee, the couch, looming over a busy guy's desk) and make small
// talk, then say bye and go.
// Desks aren't there until they're needed: when a session joins, two maintenance guys walk in, one carrying the desk
// and the other his chair, set it down at the guy's spot while he waits beside it, and walk out. When a session ends
// they come back for its desk. Only your station is always there.
// The webview calls syncOffice when the sessions change, syncYou when you come or go, and stepOffice every frame;
// time is in seconds.

import { DRINK_PROPS, findPath, isWalkable, nearestWalkable, OfficeLayout, openFloorTiles, Point } from "./officeLayout";
import {
  BACK_LINES, BREAK_LINES, chatPhrase, CREW_BUILD_LINES, CREW_DONE_LINES, CREW_HELP_LINES, CREW_NEVER_MIND_LINES, CREW_REMOVE_LINES,
  CREW_START_LINES, exchangeAnswer, MUSE_LINES, MuseMode, pickExchange, pickPhrase, RUSH_LINES, SLEEP_LINES, THANKS_LINES, TYPING_LINES,
  WAIT_LINES, WAKE_IDLE_LINES, WAKE_TO_WORK_LINES,
} from "./officePhrases";
import { audienceLine, FoodKind, PERFORMANCES, PerformanceKindId, ShowCue, ShowLine, ShowRole } from "./officePerformances";
import { MAX_VISITORS, personalityOf, visitorReaction } from "./officeVisitors";
import type { Facing, Pose } from "./pixelGuy";

export type AgentStatus = "working" | "idle" | "asleep";

export interface AgentInput {
  id: string;
  seed: string;
  status: AgentStatus;
  title: string;
}

export type AgentMode =
  | "walk" | "type" | "sit" | "stretch" | "drink" | "loiter" | "chat" | "wait" | "couch" | "sleep" | "address" | "build"
  // In the crowd at a show, and on stage putting one on.
  | "watch" | "perform";

export type AgentGoal =
  | { kind: "work" }
  | { kind: "sleep" }
  | { kind: "desk" }
  | { kind: "prop"; propIndex: number }
  | { kind: "couch" }
  | { kind: "wander" }
  | { kind: "chat"; partnerId: string }
  // You, standing behind a busy guy's chair, talking while he types.
  | { kind: "visit"; agentId: string }
  // A visitor, headed to the middle of the room to say his piece.
  | { kind: "address" }
  // A session's guy whose desk isn't in yet, waiting beside its spot.
  | { kind: "waitDesk" }
  // A maintenance guy on a job; his crew phase says which step.
  | { kind: "crew" }
  // A performer headed for his spot on stage, and a guy headed for a spot in the crowd.
  | { kind: "perform" }
  | { kind: "show" }
  | { kind: "door" };

export interface Agent {
  id: string;
  seed: string;
  title: string;
  status: AgentStatus;
  x: number;
  y: number;
  facing: Facing;
  path: Point[];
  running: boolean;
  goal: AgentGoal | undefined;
  // The tile the agent is headed to or using, so two guys don't pick the same cooler.
  target: Point | undefined;
  mode: AgentMode;
  modeUntil: number;
  // A desk index, or undefined for a guy who works from the couch or the floor because the desks ran out.
  deskIndex: number | undefined;
  workSpot: Point;
  bubble: { text: string; until: number } | undefined;
  nextBubbleAt: number;
  leaving: boolean;
  // You, not a session: works at the station, and isn't counted.
  you: boolean;
  // Yours only: when your break starts, or ends while you're on one.
  nextBreakAt: number;
  // Stopped to watch a critter go by: faces it and stands still until then.
  watch: { facing: Facing; until: number } | undefined;
  // A visitor from another department, not a session.
  visitor: VisitorState | undefined;
  // A maintenance guy, not a session.
  crew: CrewState | undefined;
  // The answer he owes the guy he's chatting with, said on his next turn if it's still fresh.
  reply?: { text: string; until: number };
  // Someone putting on a show, not a session.
  performer: PerformerState | undefined;
  // In the crowd: his answer to the last cue, said a moment after it; arms up until cheerUntil; what he's eating.
  react?: { text: string; at: number; cheer: boolean };
  cheerUntil: number;
  snack?: FoodKind;
}

export interface PerformerState {
  role: ShowRole;
  spot: Point;
  // Taking a bow at the end.
  bowing: boolean;
}

// arriving: the performers walking in to their spots. playing: the show, the lead saying his lines over its length.
// bows: the closer said, a few seconds of applause before everyone heads off.
export type ShowPhase = "arriving" | "playing" | "bows";

export interface ShowState {
  kind: PerformanceKindId;
  title: string;
  // The lead's spot; the others stand beside it, the drummer behind.
  stage: Point;
  spots: Point[];
  phase: ShowPhase;
  performerIds: string[];
  lines: readonly ShowLine[];
  closer: ShowLine;
  spoken: number;
  nextLineAt: number;
  lineGap: number;
  length: number;
  startedAt: number;
  endsAt: number;
  // Starts anyway if a performer can't make it to his spot by then.
  giveUpAt: number;
  nextGatherAt: number;
  food: readonly FoodKind[];
  // The last cue and when, for the view's effects (sparkles, confetti).
  lastCue: { cue: ShowCue; at: number } | undefined;
}

export interface ShowInput {
  kind: PerformanceKindId;
  title: string;
  // One per role in the spec, the lead first.
  performers: readonly { id: string; seed: string; title: string; role: ShowRole }[];
  lines: readonly ShowLine[];
  closer: ShowLine;
  length: number;
  food?: readonly FoodKind[];
}

export interface CrewJob {
  kind: "deliver" | "remove";
  deskIndex: number;
  // The seed of the guy the desk is for, which sets its style.
  seed: string;
}

// fetch: to the door for a desk. toSlot: to the desk's spot. build: setting it down or taking it apart. haul: carrying
// it out. help: standing by while his partner works. out: leaving, nothing to do.
export type CrewPhase = "idle" | "fetch" | "toSlot" | "build" | "haul" | "help" | "out";

export interface CrewState {
  job: CrewJob | undefined;
  phase: CrewPhase;
  // The seed of the desk he's carrying, or undefined when his hands are empty.
  carrying: string | undefined;
  // Carrying the chair for his partner's desk.
  chair: boolean;
}

export interface VisitorState {
  // His arrival lines, and how many he's said.
  lines: readonly string[];
  spoken: number;
  boss: boolean;
  smallTalk: readonly string[];
  farewell: string | undefined;
  // Seconds to hang around after his lines, and when that runs out once he's started.
  stay: number;
  stayUntil: number;
  nextRemarkAt: number;
  // Every line he's said to the room, arrival lines and small talk alike, so the view can have the room answer.
  remarks: number;
}

export interface VisitorInput {
  id: string;
  seed: string;
  title: string;
  lines: readonly string[];
  boss?: boolean;
  smallTalk?: readonly string[];
  farewell?: string;
  // Seconds to hang around after his lines; 0 or missing walks right back out.
  stay?: number;
}

export interface OfficeState {
  layout: OfficeLayout;
  agents: Agent[];
  time: number;
  // The desks standing in the room, by index into layout.desks, each with the seed of the guy it came in for.
  placed: Map<number, string>;
  // The show on now, if any.
  show?: ShowState;
  // How much the guys talk on their own (officeChatter's talkFactor): 0 is never, 1 the usual.
  talk?: number;
}

export type Random = () => number;

const WALK_SPEED = 2.4;
const RUN_SPEED = 5.5;
const FOREVER = Number.POSITIVE_INFINITY;
const CHAT_WAIT_SECONDS = 10;


export const YOU_AGENT_ID = "you";

const between = (random: Random, low: number, high: number) => low + random() * (high - low);
const talkOf = (state: OfficeState) => state.talk ?? 1;

export function createOffice(layout: OfficeLayout): OfficeState {
  clearDeskSpots(layout);
  return { layout, agents: [], time: 0, placed: new Map() };
}

export const CREW_IDS = ["crew-1", "crew-2"] as const;
const CREW_TITLE = "Maintenance";

// A session's guy: not you, not a visitor, not the crew, not a performer.
function isSession(agent: Agent): boolean {
  return !agent.you && agent.visitor === undefined && agent.crew === undefined && agent.performer === undefined;
}

export function crewAgents(state: OfficeState): Agent[] {
  return state.agents.filter((agent) => agent.crew !== undefined);
}

// Every desk spot starts as bare floor.
function clearDeskSpots(layout: OfficeLayout): void {
  for (const desk of layout.desks) {
    layout.tiles[desk.desk.y][desk.desk.x] = "floor";
    layout.tiles[desk.seat.y][desk.seat.x] = "floor";
  }
}

export function hasDesk(state: OfficeState, agent: Agent): boolean {
  return agent.deskIndex !== undefined && state.placed.has(agent.deskIndex);
}

// Puts a desk and its chair at a spot. Anyone standing where the desk goes steps out of the way.
function placeDesk(state: OfficeState, index: number, seed: string): void {
  const desk = state.layout.desks[index];
  if (desk === undefined) {
    return;
  }
  state.layout.tiles[desk.desk.y][desk.desk.x] = "desk";
  state.layout.tiles[desk.seat.y][desk.seat.x] = "seat";
  state.placed.set(index, seed);
  for (const agent of state.agents) {
    if (isAt(agent, desk.desk) || (agent.path.length > 0 && agent.path.some((step) => step.x === desk.desk.x && step.y === desk.desk.y))) {
      const moved = nearestWalkable(state.layout, here(agent));
      if (isAt(agent, desk.desk)) {
        agent.x = moved.x;
        agent.y = moved.y;
      }
      agent.path = [];
      agent.modeUntil = state.time;
    }
  }
}

function removeDesk(state: OfficeState, index: number): void {
  const desk = state.layout.desks[index];
  state.placed.delete(index);
  if (desk !== undefined) {
    state.layout.tiles[desk.desk.y][desk.desk.x] = "floor";
    state.layout.tiles[desk.seat.y][desk.seat.x] = "floor";
  }
}

// Where a guy waits for his desk: just below his chair's spot, facing it.
function deskWaitSpot(state: OfficeState, agent: Agent): Point {
  const below = { x: agent.workSpot.x, y: agent.workSpot.y + 1 };
  return state.layout.tiles[below.y]?.[below.x] === "floor" ? below : agent.workSpot;
}

// Adds guys for new sessions, sends ended sessions' guys out, and reacts to busy and idle flips. New guys walk in from
// the door, or with "seated" (the view just opened) start at their desks as if they'd been there all along.
export function syncOffice(
  state: OfficeState,
  inputs: readonly AgentInput[],
  random: Random,
  entrance: "door" | "seated" = "door",
): void {
  const inputsById = new Map(inputs.map((input) => [input.id, input]));
  for (const agent of state.agents) {
    if (!isSession(agent)) {
      continue;
    }
    const input = inputsById.get(agent.id);
    if (input === undefined) {
      if (!agent.leaving) {
        leave(state, agent);
      }
      continue;
    }
    agent.title = input.title;
    agent.seed = input.seed;
    if (agent.leaving) {
      // The session came back before he got out the door.
      agent.leaving = false;
      agent.status = input.status;
      decide(state, agent, random);
      continue;
    }
    if (agent.status !== input.status) {
      agent.status = input.status;
      onStatusChange(state, agent, random);
    }
  }
  const known = new Set(state.agents.filter(isSession).map((agent) => agent.id));
  const newcomers = inputs.filter((input) => !known.has(input.id)).map((input) => newAgent(state, input, random));
  state.agents.push(...newcomers);
  assignWorkSpots(state);
  for (const agent of newcomers) {
    if (entrance === "seated") {
      // They were here all along, desks and all.
      if (agent.deskIndex !== undefined) {
        placeDesk(state, agent.deskIndex, agent.seed);
      }
      agent.x = agent.workSpot.x;
      agent.y = agent.workSpot.y;
      agent.facing = "up";
      if (agent.status === "asleep") {
        agent.goal = { kind: "sleep" };
        setMode(state, agent, "sleep", FOREVER);
        continue;
      }
      if (agent.status === "idle") {
        // Stagger when they get up, so the room doesn't stand up at once.
        agent.mode = agent.deskIndex === undefined ? "couch" : "sit";
        agent.modeUntil = state.time + between(random, 1, 12);
        continue;
      }
    }
    decide(state, agent, random);
  }
}

// Puts you at your station (seed is your sprite key), keeps you as you are, or takes you out when seed is undefined
// or the room has no station.
export function syncYou(state: OfficeState, seed: string | undefined, random: Random): void {
  const current = youAgent(state);
  const seat = state.layout.station?.seat;
  if (seed === undefined || seat === undefined) {
    if (current !== undefined) {
      removeAgent(state, current);
    }
    return;
  }
  if (current !== undefined) {
    current.seed = seed;
    return;
  }
  const agent: Agent = {
    ...newAgent(state, { id: YOU_AGENT_ID, seed, status: "working", title: "you" }, random),
    x: seat.x,
    y: seat.y,
    facing: "up",
    workSpot: seat,
    you: true,
    nextBreakAt: state.time + between(random, 25, 60),
  };
  state.agents.push(agent);
  setMode(state, agent, "type", FOREVER);
}

export function youAgent(state: OfficeState): Agent | undefined {
  return state.agents.find((agent) => agent.you);
}

// You're at your desk: seated at the station and not on a break.
export function isAtStation(agent: Agent): boolean {
  return agent.status === "working" && agent.path.length === 0 && isAt(agent, agent.workSpot);
}

// Someone from another department walks in from the door and heads for the middle of the room. Returns undefined
// when the room already has MAX_VISITORS or there's nowhere to stand.
export function visitorArrives(state: OfficeState, input: VisitorInput, random: Random): Agent | undefined {
  if (visitorAgents(state).length >= MAX_VISITORS || input.lines.length === 0) {
    return undefined;
  }
  const { cols, rows } = state.layout;
  const spots = openFloorTiles(state.layout)
    .filter((tile) => tile.y > 0 && !state.agents.some((agent) => agent.target?.x === tile.x && agent.target?.y === tile.y))
    .sort((first, second) => Math.hypot(first.x - cols / 2, first.y - rows / 2) - Math.hypot(second.x - cols / 2, second.y - rows / 2))
    .slice(0, 6);
  if (spots.length === 0) {
    return undefined;
  }
  const agent: Agent = {
    ...newAgent(state, { id: input.id, seed: input.seed, status: "working", title: input.title }, random),
    visitor: {
      lines: input.lines,
      spoken: 0,
      boss: input.boss ?? false,
      smallTalk: input.smallTalk ?? [],
      farewell: input.farewell,
      stay: Math.max(0, input.stay ?? 0),
      stayUntil: 0,
      nextRemarkAt: FOREVER,
      remarks: 0,
    },
  };
  state.agents.push(agent);
  goTo(state, agent, spots[Math.floor(random() * spots.length)], { kind: "address" }, false, random);
  return agent;
}

export function visitorAgents(state: OfficeState): Agent[] {
  return state.agents.filter((agent) => agent.visitor !== undefined);
}

// Still on his way in or saying his arrival lines.
function isAddressing(agent: Agent): boolean {
  return agent.visitor !== undefined && agent.goal?.kind === "address";
}

// Turns a standing idle guy to look at a point (a visitor, say) for a moment. Seated and busy guys stay put.
export function lookToward(state: OfficeState, agent: Agent, at: { x: number; y: number }, seconds: number): void {
  if (agent.status !== "idle" || agent.leaving || SEATED_MODES.has(agent.mode) || agent.mode === "chat") {
    return;
  }
  const dx = at.x - agent.x;
  const dy = at.y - agent.y;
  const facing: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
  agent.watch = { facing, until: state.time + seconds };
}

// Says the visitor's next arrival line. Once he's said them all he hangs around, or walks out if he isn't staying.
function stepVisitor(state: OfficeState, agent: Agent, random: Random): void {
  const visit = agent.visitor;
  if (visit === undefined) {
    return;
  }
  if (agent.mode !== "address") {
    // Couldn't get to his spot: never mind, he'll come back another time.
    leave(state, agent);
    return;
  }
  if (state.time < agent.nextBubbleAt) {
    return;
  }
  if (visit.spoken >= visit.lines.length) {
    if (visit.stay <= 0) {
      leave(state, agent);
      return;
    }
    // Settles in: from here on he's an idle guy who isn't a session.
    visit.stayUntil = state.time + visit.stay;
    visit.nextRemarkAt = state.time + between(random, 15, 35);
    agent.status = "idle";
    agent.goal = undefined;
    setMode(state, agent, "loiter", between(random, 0.5, 1.5));
    return;
  }
  const line = visit.lines[visit.spoken];
  visit.spoken += 1;
  visit.remarks += 1;
  const seconds = lineSeconds(line);
  say(state, agent, line, seconds);
  agent.nextBubbleAt = state.time + seconds + 0.9;
}

// A visitor hanging around pipes up now and then with something to the room, when he isn't busy talking.
function stepHangout(state: OfficeState, agent: Agent, random: Random): void {
  const visit = agent.visitor;
  if (visit === undefined || state.time < visit.nextRemarkAt || visit.smallTalk.length === 0) {
    return;
  }
  visit.nextRemarkAt = state.time + between(random, 25, 60);
  if (agent.bubble !== undefined || agent.mode === "chat" || agent.mode === "wait") {
    return;
  }
  const line = visit.smallTalk[Math.floor(random() * visit.smallTalk.length)];
  visit.remarks += 1;
  say(state, agent, line, lineSeconds(line));
}

// A visitor done hanging around says bye and heads out.
function visitorLeaves(state: OfficeState, agent: Agent): void {
  const farewell = agent.visitor?.farewell;
  if (farewell !== undefined && agent.visitor?.stayUntil !== 0) {
    say(state, agent, farewell, 2);
  }
  leave(state, agent);
}

// Longer lines stay up longer.
function lineSeconds(line: string): number {
  return Math.min(4.5, 2.2 + line.length * 0.05);
}

// A scene event: drop what you're doing and run back to your desk.
export function callYouBack(state: OfficeState, random: Random): void {
  const agent = youAgent(state);
  if (agent === undefined) {
    return;
  }
  agent.nextBreakAt = state.time + between(random, 40, 90);
  if (isAtStation(agent)) {
    return;
  }
  endChat(state, agent);
  agent.watch = undefined;
  agent.status = "working";
  say(state, agent, "!", 1);
  goTo(state, agent, agent.workSpot, { kind: "work" }, true, random);
}

function stepYou(state: OfficeState, agent: Agent, random: Random): void {
  if (state.time < agent.nextBreakAt) {
    return;
  }
  if (agent.status === "working") {
    if (!isAtStation(agent)) {
      return;
    }
    agent.status = "idle";
    agent.nextBreakAt = state.time + between(random, 20, 40);
    say(state, agent, pickPhrase(BREAK_LINES, random), 1.4);
    if (!joinShow(state, agent, random)) {
      pickIdleActivity(state, agent, random);
    }
    return;
  }
  if (agent.goal?.kind === "show" && state.show !== undefined) {
    // You stay for the show.
    agent.nextBreakAt = state.time + 5;
    return;
  }
  endChat(state, agent);
  agent.status = "working";
  agent.nextBreakAt = state.time + between(random, 45, 100);
  say(state, agent, pickPhrase(BACK_LINES, random), 1.4);
  goTo(state, agent, agent.workSpot, { kind: "work" }, false, random);
}

// Swaps in a new floor plan after a resize, keeps desks where it can, and has everyone pick up again from where they are.
export function relayoutOffice(state: OfficeState, layout: OfficeLayout, random: Random): void {
  clearDeskSpots(layout);
  state.layout = layout;
  state.placed = new Map();
  for (const agent of state.agents) {
    const here = { x: Math.round(agent.x), y: Math.round(agent.y) };
    if (!isWalkable(layout, here)) {
      const moved = nearestWalkable(layout, here);
      agent.x = moved.x;
      agent.y = moved.y;
    }
    agent.path = [];
    agent.target = undefined;
    if (agent.deskIndex !== undefined && agent.deskIndex >= layout.desks.length) {
      agent.deskIndex = undefined;
    }
  }
  assignWorkSpots(state);
  // The room changed shape: everyone's desk is just there, and the crew has nothing left to carry.
  for (const agent of state.agents) {
    if (agent.deskIndex !== undefined && isSession(agent) && !agent.leaving) {
      placeDesk(state, agent.deskIndex, agent.seed);
    }
    if (agent.crew !== undefined) {
      agent.crew = { job: undefined, phase: "idle", carrying: undefined, chair: false };
    }
  }
  // The show goes on if its stage is still open floor; otherwise it's over.
  const show = state.show;
  if (show !== undefined && !show.spots.every((spot) => layout.tiles[spot.y]?.[spot.x] === "floor" && spot.y >= 1)) {
    endShow(state, random);
  }
  for (const agent of state.agents) {
    if (agent.crew !== undefined) {
      crewDecide(state, agent, random);
    } else if (agent.leaving) {
      leave(state, agent);
    } else if (!isAddressing(agent)) {
      // A visitor mid-speech keeps talking from where he stands; one still walking in gives up (stepVisitor).
      decide(state, agent, random);
    }
  }
}

export function stepOffice(state: OfficeState, seconds: number, random: Random): void {
  const dt = Math.max(0, Math.min(seconds, 0.25));
  state.time += dt;
  manageCrew(state, random);
  stepShow(state, random);
  for (const agent of [...state.agents]) {
    if (agent.bubble !== undefined && state.time >= agent.bubble.until) {
      agent.bubble = undefined;
    }
    if (agent.watch !== undefined && (state.time >= agent.watch.until || agent.status !== "idle" || agent.leaving)) {
      agent.watch = undefined;
    }
    if (agent.watch !== undefined) {
      continue;
    }
    if (agent.you) {
      stepYou(state, agent, random);
    }
    if (isAddressing(agent) && agent.path.length === 0) {
      stepVisitor(state, agent, random);
      continue;
    }
    if (agent.visitor !== undefined && !agent.leaving && agent.path.length === 0) {
      stepHangout(state, agent, random);
    }
    if (agent.path.length > 0) {
      move(agent, dt);
      if (agent.path.length === 0) {
        arrive(state, agent, random);
      }
      continue;
    }
    const visited = agent.goal?.kind === "visit" ? visitedAgent(state, agent) : undefined;
    if (agent.mode === "chat" && (agent.goal?.kind === "visit" ? visited === undefined : !chatPartnerOf(state, agent))) {
      agent.modeUntil = state.time;
    }
    if (agent.mode === "chat" && state.time >= agent.nextBubbleAt && talkOf(state) > 0) {
      // At a busy guy's desk, he answers over his shoulder about half the time.
      const speaker = visited !== undefined && visited.bubble === undefined && random() < 0.45 ? visited : agent;
      const listener = speaker === agent ? visited ?? chatPartnerOf(state, agent) : agent;
      const line = chatLine(state, speaker, listener, random);
      say(state, speaker, line, line.length > 4 ? lineSeconds(line) : between(random, 1, 1.8));
      agent.nextBubbleAt = state.time + (between(random, 1.6, 3.4) + (line.length > 4 ? 1.2 : 0)) * Math.max(1, 1 / Math.sqrt(talkOf(state)));
    }
    if (agent.goal?.kind === "waitDesk" && agent.mode === "wait") {
      if (hasDesk(state, agent)) {
        say(state, agent, pickPhrase(THANKS_LINES, random), 1.4);
        decide(state, agent, random);
        continue;
      }
      if (state.time >= agent.nextBubbleAt) {
        say(state, agent, pickPhrase(WAIT_LINES, random), 1.4);
        agent.nextBubbleAt = state.time + between(random, 4, 9);
      }
    }
    if (agent.mode === "watch") {
      stepWatcher(state, agent, random);
    }
    if (agent.crew?.phase === "help" && state.time >= agent.nextBubbleAt) {
      say(state, agent, pickPhrase(CREW_HELP_LINES, random), 1.4);
      agent.nextBubbleAt = state.time + between(random, 2.5, 5);
    }
    if (agent.mode === "type" && state.time >= agent.nextBubbleAt) {
      if (random() < Math.min(0.9, 0.35 * talkOf(state))) {
        say(state, agent, pickPhrase(TYPING_LINES, random), 1.4);
      }
      agent.nextBubbleAt = state.time + between(random, 10, 25);
    }
    const muse = museMode(agent);
    if (muse !== undefined && agent.bubble === undefined && state.time >= agent.nextBubbleAt) {
      if (random() < Math.min(0.9, 0.3 * talkOf(state))) {
        say(state, agent, pickPhrase(MUSE_LINES[muse], random), 1.4);
      }
      agent.nextBubbleAt = state.time + between(random, 8, 20);
    }
    if (state.time >= agent.modeUntil) {
      decide(state, agent, random);
    }
  }
}

const SEATED_MODES: ReadonlySet<AgentMode> = new Set<AgentMode>(["type", "sit", "couch", "stretch", "sleep"]);

// A critter is passing at (x, y) in tiles. Idle guys within reach who haven't reacted to it yet (ids in reacted)
// stop, turn to look, and say a line; a guy on the couch just says it. Returns who reacted.
export const CRITTER_REACH = { x: 3, y: 2 };

export function reactToCritter(state: OfficeState, at: { x: number; y: number }, lines: readonly string[], reacted: ReadonlySet<string>, random: Random): string[] {
  const watchers: string[] = [];
  for (const agent of state.agents) {
    if (reacted.has(agent.id) || agent.status !== "idle" || agent.leaving || agent.bubble !== undefined) {
      continue;
    }
    const dx = at.x - agent.x;
    const dy = at.y - agent.y;
    if (Math.abs(dx) > CRITTER_REACH.x || Math.abs(dy) > CRITTER_REACH.y) {
      continue;
    }
    watchers.push(agent.id);
    if (random() < 0.25) {
      continue;
    }
    say(state, agent, lines[Math.floor(random() * lines.length) % lines.length], 1.6);
    if (!SEATED_MODES.has(agent.mode)) {
      const facing: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
      agent.watch = { facing, until: state.time + between(random, 1.2, 2) };
    }
  }
  return watchers;
}

export interface AgentPose {
  pose: Pose;
  facing: Facing;
  frame: number;
  // Seated guys draw a little lower, into their chair.
  seated: boolean;
}

export function agentPose(agent: Agent, time: number): AgentPose {
  const phase = (agent.id.length * 0.37) % 1;
  if (agent.path.length === 0 && agent.mode === "perform" && agent.performer !== undefined) {
    return performerPose(agent, agent.performer, time);
  }
  if (agent.path.length === 0 && agent.mode === "watch") {
    if (time < agent.cheerUntil) {
      return { pose: "cheer", facing: agent.facing, frame: Math.floor(time * 4 + phase * 2), seated: false };
    }
    if (agent.snack !== undefined && agent.bubble === undefined) {
      return { pose: "eat", facing: agent.facing, frame: Math.floor(time * 1.2 + phase * 2), seated: false };
    }
    return { pose: agent.bubble === undefined ? "stand" : "talk", facing: agent.facing, frame: Math.floor(time * 5), seated: false };
  }
  if (agent.watch !== undefined && time < agent.watch.until && !SEATED_MODES.has(agent.mode)) {
    return { pose: "stand", facing: agent.watch.facing, frame: 0, seated: false };
  }
  const carrying = agent.crew !== undefined && (agent.crew.carrying !== undefined || agent.crew.chair);
  if (agent.path.length > 0) {
    return { pose: carrying ? "carry" : "walk", facing: agent.facing, frame: Math.floor(time * (agent.running ? 12 : 7)), seated: false };
  }
  if (carrying && agent.mode !== "build") {
    return { pose: "carry", facing: agent.facing, frame: 0, seated: false };
  }
  switch (agent.mode) {
    case "build":
      return { pose: "build", facing: agent.facing, frame: Math.floor(time * 4), seated: false };
    case "type":
      return { pose: "type", facing: agent.facing, frame: Math.floor(time * 6 + phase * 2), seated: true };
    case "sit":
    case "couch":
      return { pose: "sit", facing: agent.facing, frame: 0, seated: true };
    case "stretch":
      return { pose: "stretch", facing: agent.facing, frame: 0, seated: true };
    case "sleep":
      // A slow breath: about four seconds in and out.
      return { pose: "sleep", facing: agent.facing, frame: Math.floor(time / 2 + phase * 2), seated: true };
    case "drink":
      return { pose: "drink", facing: agent.facing, frame: 0, seated: false };
    case "chat":
    case "address":
      return { pose: "talk", facing: agent.facing, frame: agent.bubble === undefined ? 0 : Math.floor(time * 5), seated: false };
    default:
      return { pose: "stand", facing: agent.facing, frame: 0, seated: false };
  }
}

export function officeCounts(state: OfficeState): { working: number; idle: number; asleep: number } {
  const present = state.agents.filter((agent) => !agent.leaving && isSession(agent));
  return {
    working: present.filter((agent) => agent.status === "working").length,
    idle: present.filter((agent) => agent.status === "idle").length,
    asleep: present.filter((agent) => agent.status === "asleep").length,
  };
}

function newAgent(state: OfficeState, input: AgentInput, random: Random): Agent {
  const door = state.layout.door;
  return {
    id: input.id,
    seed: input.seed,
    title: input.title,
    status: input.status,
    x: door.x,
    y: door.y,
    facing: "down",
    path: [],
    running: false,
    goal: undefined,
    target: undefined,
    mode: "loiter",
    modeUntil: state.time,
    deskIndex: undefined,
    workSpot: door,
    bubble: undefined,
    nextBubbleAt: state.time + between(random, 2, 6),
    leaving: false,
    you: false,
    nextBreakAt: FOREVER,
    watch: undefined,
    visitor: undefined,
    crew: undefined,
    performer: undefined,
    cheerUntil: 0,
  };
}

// Keeps each guy's desk if it still exists, hands free desks out in order, then couch seats, then open floor.
function assignWorkSpots(state: OfficeState): void {
  const { desks, couchSeats } = state.layout;
  for (const agent of state.agents) {
    if (agent.you) {
      agent.deskIndex = undefined;
      agent.workSpot = state.layout.station?.seat ?? state.layout.door;
    } else if (!isSession(agent)) {
      agent.deskIndex = undefined;
      agent.workSpot = state.layout.door;
    }
  }
  const present = state.agents.filter((agent) => !agent.leaving && isSession(agent));
  const takenDesks = new Set<number>();
  for (const agent of present) {
    if (agent.deskIndex !== undefined && !takenDesks.has(agent.deskIndex) && agent.deskIndex < desks.length) {
      takenDesks.add(agent.deskIndex);
    } else {
      agent.deskIndex = undefined;
    }
  }
  // A desk still standing from a guy who left goes to the next one in, before the crew brings a new one.
  const freeDesks = desks.map((_, index) => index).filter((index) => !takenDesks.has(index))
    .sort((first, second) => Number(state.placed.has(second)) - Number(state.placed.has(first)) || first - second);
  const overflowSpots = [...couchSeats, ...openFloorTiles(state.layout).filter((tile) => tile.y >= state.layout.rows - 2)];
  let overflowIndex = 0;
  for (const agent of present) {
    if (agent.deskIndex === undefined && freeDesks.length > 0) {
      agent.deskIndex = freeDesks.shift();
    }
    if (agent.deskIndex !== undefined) {
      agent.workSpot = desks[agent.deskIndex].seat;
    } else {
      agent.workSpot = overflowSpots[overflowIndex++ % Math.max(1, overflowSpots.length)] ?? state.layout.door;
    }
  }
}

function onStatusChange(state: OfficeState, agent: Agent, random: Random): void {
  endChat(state, agent);
  const wasAsleep = agent.mode === "sleep";
  if (wasAsleep) {
    say(state, agent, pickPhrase(agent.status === "working" ? WAKE_TO_WORK_LINES : WAKE_IDLE_LINES, random), 1.6);
  }
  if (agent.status === "asleep") {
    say(state, agent, pickPhrase(SLEEP_LINES, random), 1.6);
    goTo(state, agent, agent.workSpot, { kind: "sleep" }, false, random);
    return;
  }
  if (wasAsleep && agent.status === "idle") {
    // Waking up slow: a few seconds at the desk before getting up.
    setMode(state, agent, agent.deskIndex === undefined ? "couch" : "sit", between(random, 3, 6));
    return;
  }
  if (agent.status === "working") {
    const atWork = agent.path.length === 0 && isAt(agent, agent.workSpot);
    if (!atWork) {
      say(state, agent, pickPhrase(RUSH_LINES, random), 1.2);
    }
    goTo(state, agent, agent.workSpot, { kind: "work" }, !atWork, random);
    return;
  }
  // Just went idle: lean back at the desk for a bit before getting up.
  if (agent.path.length === 0 && isAt(agent, agent.workSpot)) {
    agent.mode = agent.deskIndex === undefined ? "couch" : "sit";
    agent.modeUntil = state.time + between(random, 3, 8);
  } else if (agent.path.length > 0) {
    // Still on the way: finish the step he's on, then look around and pick something else.
    agent.path = agent.path.slice(0, 1);
    agent.goal = undefined;
    agent.target = agent.path[0];
  } else {
    agent.modeUntil = state.time;
  }
}

function decide(state: OfficeState, agent: Agent, random: Random): void {
  agent.running = false;
  if (agent.crew !== undefined) {
    crewDecide(state, agent, random);
    return;
  }
  if (agent.leaving) {
    leave(state, agent);
    return;
  }
  if (agent.performer !== undefined) {
    performerDecide(state, agent, random);
    return;
  }
  if (agent.visitor !== undefined) {
    if (isAddressing(agent) || state.time >= agent.visitor.stayUntil) {
      visitorLeaves(state, agent);
      return;
    }
    endChat(state, agent);
    if (!joinShow(state, agent, random)) {
      pickIdleActivity(state, agent, random);
    }
    return;
  }
  if (agent.status !== "working" && joinShow(state, agent, random)) {
    return;
  }
  if (agent.status === "working") {
    goTo(state, agent, agent.workSpot, { kind: "work" }, false, random);
    return;
  }
  if (agent.status === "asleep") {
    goTo(state, agent, agent.workSpot, { kind: "sleep" }, false, random);
    return;
  }
  endChat(state, agent);
  pickIdleActivity(state, agent, random);
}

function pickIdleActivity(state: OfficeState, agent: Agent, random: Random): void {
  const atDesk = hasDesk(state, agent) && agent.path.length === 0 && isAt(agent, agent.workSpot);
  const freeProps = state.layout.props
    .map((prop, propIndex) => ({ prop, propIndex }))
    .filter(({ prop }) => prop.stand !== undefined && !isTargeted(state, agent, prop.stand));
  const freeCouch = state.layout.couchSeats.filter((seat) => !isTargeted(state, agent, seat) && !isWorkSpotOfOther(state, agent, seat));
  const partners = state.agents.filter((other) => other !== agent && canChat(other));
  const options: { weight: number; run: () => void }[] = [
    { weight: 2, run: () => wander(state, agent, random) },
  ];
  if (hasDesk(state, agent) && !atDesk) {
    options.push({ weight: 2, run: () => goTo(state, agent, agent.workSpot, { kind: "desk" }, false, random) });
  }
  if (atDesk) {
    options.push({ weight: 1, run: () => setMode(state, agent, "stretch", between(random, 1.5, 2.5)) });
    options.push({ weight: 1, run: () => setMode(state, agent, "sit", between(random, 4, 9)) });
  }
  if (freeProps.length > 0) {
    options.push({
      weight: 3,
      run: () => {
        const { prop, propIndex } = freeProps[Math.floor(random() * freeProps.length)];
        goTo(state, agent, prop.stand as Point, { kind: "prop", propIndex }, false, random);
      },
    });
  }
  if (freeCouch.length > 0) {
    options.push({ weight: 1, run: () => goTo(state, agent, freeCouch[Math.floor(random() * freeCouch.length)], { kind: "couch" }, false, random) });
  }
  if (partners.length > 0 && talkOf(state) > 0) {
    options.push({ weight: (agent.you ? 6 : 3) * talkOf(state), run: () => startChat(state, agent, partners[Math.floor(random() * partners.length)], random) });
  }
  if (agent.you || agent.visitor !== undefined) {
    const visits = state.agents
      .filter((other) => other !== agent && other.status === "working" && other.deskIndex !== undefined && other.mode === "type" && other.path.length === 0)
      .map((other) => ({ other, spot: { x: other.workSpot.x, y: other.workSpot.y + 1 } }))
      .filter(({ spot }) => state.layout.tiles[spot.y]?.[spot.x] === "floor" && !isTargeted(state, agent, spot));
    if (visits.length > 0) {
      // Bosses love to loom.
      options.push({
        weight: agent.you ? 6 : agent.visitor?.boss === true ? 4 : 2,
        run: () => {
          const { other, spot } = visits[Math.floor(random() * visits.length)];
          goTo(state, agent, spot, { kind: "visit", agentId: other.id }, false, random);
        },
      });
    }
  }
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let roll = random() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll < 0) {
      option.run();
      return;
    }
  }
  options[options.length - 1].run();
}

function canChat(agent: Agent): boolean {
  return !agent.leaving && agent.status === "idle" && agent.performer === undefined && agent.goal?.kind !== "chat" && agent.goal?.kind !== "show" &&
    agent.mode !== "chat" && agent.mode !== "wait" && agent.mode !== "watch";
}

// Picks two open floor tiles side by side and sends both guys there.
function startChat(state: OfficeState, agent: Agent, partner: Agent, random: Random): void {
  const pairs = openFloorTiles(state.layout).filter((tile) =>
    state.layout.tiles[tile.y][tile.x + 1] === "floor" &&
    !isTargeted(state, agent, tile) && !isTargeted(state, partner, { x: tile.x + 1, y: tile.y }),
  );
  if (pairs.length === 0) {
    wander(state, agent, random);
    return;
  }
  const left = pairs[Math.floor(random() * pairs.length)];
  goTo(state, agent, left, { kind: "chat", partnerId: partner.id }, false, random);
  goTo(state, partner, { x: left.x + 1, y: left.y }, { kind: "chat", partnerId: agent.id }, false, random);
}

function wander(state: OfficeState, agent: Agent, random: Random): void {
  const open = openFloorTiles(state.layout).filter((tile) => !isTargeted(state, agent, tile) && tile.y > 0);
  if (open.length === 0) {
    setMode(state, agent, "loiter", between(random, 2, 4));
    return;
  }
  goTo(state, agent, open[Math.floor(random() * open.length)], { kind: "wander" }, false, random);
}

function leave(state: OfficeState, agent: Agent): void {
  endChat(state, agent);
  agent.leaving = true;
  agent.deskIndex = undefined;
  const path = findPath(state.layout, here(agent), state.layout.door);
  if (path === undefined || path.length === 0) {
    removeAgent(state, agent);
    return;
  }
  agent.goal = { kind: "door" };
  agent.target = state.layout.door;
  agent.path = path;
  agent.mode = "walk";
  agent.running = false;
}

function goTo(state: OfficeState, agent: Agent, target: Point, goal: AgentGoal, running: boolean, random: Random): void {
  // No desk yet: wait beside its spot instead of sitting on air.
  if ((goal.kind === "work" || goal.kind === "sleep" || goal.kind === "desk") && agent.deskIndex !== undefined && !hasDesk(state, agent)) {
    goal = { kind: "waitDesk" };
    target = deskWaitSpot(state, agent);
  }
  agent.goal = goal;
  agent.target = target;
  agent.running = running;
  const path = findPath(state.layout, here(agent), target);
  if (path === undefined) {
    // Boxed in after a relayout: step to the nearest open tile and try again soon.
    const freed = nearestWalkable(state.layout, here(agent));
    agent.x = freed.x;
    agent.y = freed.y;
    agent.path = [];
    agent.goal = undefined;
    agent.target = undefined;
    setMode(state, agent, "loiter", 0.5);
    return;
  }
  agent.path = path;
  agent.mode = "walk";
  if (path.length === 0) {
    arrive(state, agent, random);
  }
}

function move(agent: Agent, dt: number): void {
  let budget = (agent.running ? RUN_SPEED : WALK_SPEED) * dt;
  while (budget > 0 && agent.path.length > 0) {
    const next = agent.path[0];
    const dx = next.x - agent.x;
    const dy = next.y - agent.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.001) {
      agent.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
    if (distance <= budget) {
      agent.x = next.x;
      agent.y = next.y;
      agent.path.shift();
      budget -= distance;
    } else {
      agent.x += (dx / distance) * budget;
      agent.y += (dy / distance) * budget;
      budget = 0;
    }
  }
}

function arrive(state: OfficeState, agent: Agent, random: Random): void {
  const goal = agent.goal;
  agent.running = false;
  switch (goal?.kind) {
    case "work":
      agent.facing = "up";
      if (agent.status !== "working") {
        setMode(state, agent, agent.deskIndex === undefined ? "couch" : "sit", between(random, 3, 8));
        return;
      }
      setMode(state, agent, "type", FOREVER);
      agent.nextBubbleAt = state.time + between(random, 6, 20);
      return;
    case "sleep":
      agent.facing = "up";
      if (agent.status !== "asleep") {
        setMode(state, agent, "loiter", 0.5);
        return;
      }
      setMode(state, agent, "sleep", FOREVER);
      return;
    case "desk":
      agent.facing = "up";
      setMode(state, agent, "sit", between(random, 4, 10));
      return;
    case "prop": {
      const prop = state.layout.props[goal.propIndex];
      agent.facing = "down";
      setMode(state, agent, prop !== undefined && DRINK_PROPS.has(prop.kind) ? "drink" : "loiter", between(random, 4, 9));
      return;
    }
    case "couch":
      agent.facing = "up";
      setMode(state, agent, "couch", between(random, 8, 15));
      return;
    case "chat": {
      const partner = state.agents.find((other) => other.id === goal.partnerId);
      if (partner === undefined || partner.goal?.kind !== "chat" || partner.goal.partnerId !== agent.id) {
        setMode(state, agent, "loiter", between(random, 1, 3));
        return;
      }
      if (partner.mode === "wait" && partner.path.length === 0) {
        const length = between(random, 6, 12);
        agent.facing = partner.x < agent.x ? "left" : "right";
        partner.facing = agent.x < partner.x ? "left" : "right";
        setMode(state, agent, "chat", length);
        setMode(state, partner, "chat", length);
        agent.nextBubbleAt = state.time + between(random, 0.2, 0.8);
        partner.nextBubbleAt = state.time + between(random, 1.2, 2);
        return;
      }
      agent.facing = partner.x < agent.x ? "left" : "right";
      setMode(state, agent, "wait", CHAT_WAIT_SECONDS);
      return;
    }
    case "visit": {
      if (visitedAgent(state, agent) === undefined) {
        setMode(state, agent, "loiter", between(random, 1, 3));
        return;
      }
      agent.facing = "up";
      setMode(state, agent, "chat", between(random, 6, 12));
      agent.nextBubbleAt = state.time + between(random, 0.2, 0.8);
      return;
    }
    case "waitDesk":
      agent.facing = "up";
      setMode(state, agent, "wait", FOREVER);
      agent.nextBubbleAt = state.time + between(random, 1, 3);
      return;
    case "crew":
      crewArrive(state, agent, random);
      return;
    case "perform":
      agent.facing = "down";
      setMode(state, agent, state.show === undefined ? "loiter" : "perform", state.show === undefined ? 0.3 : FOREVER);
      return;
    case "show": {
      const show = state.show;
      if (show === undefined || show.phase === "bows") {
        setMode(state, agent, "loiter", between(random, 0.5, 1.5));
        return;
      }
      agent.facing = facingToward(agent, show.stage);
      setMode(state, agent, "watch", FOREVER);
      agent.nextBubbleAt = state.time + between(random, 2, 6);
      agent.snack = show.food.length > 0 ? show.food[Math.floor(random() * show.food.length)] : undefined;
      if (agent.snack !== undefined && random() < 0.5) {
        say(state, agent, random() < 0.5 ? "thanks!" : "ooh!", 1.2);
      }
      return;
    }
    case "address":
      agent.facing = "down";
      setMode(state, agent, "address", FOREVER);
      agent.nextBubbleAt = state.time + 0.3;
      return;
    case "door":
      removeAgent(state, agent);
      return;
    default:
      agent.facing = (["down", "left", "right"] as const)[Math.floor(random() * 3)];
      setMode(state, agent, "loiter", between(random, 2, 5));
  }
}

function setMode(state: OfficeState, agent: Agent, mode: AgentMode, seconds: number): void {
  agent.mode = mode;
  agent.modeUntil = state.time + seconds;
  agent.path = [];
}

function chatPartnerOf(state: OfficeState, agent: Agent): Agent | undefined {
  if (agent.goal?.kind !== "chat") {
    return undefined;
  }
  const partnerId = agent.goal.partnerId;
  const partner = state.agents.find((other) => other.id === partnerId);
  return partner?.mode === "chat" && partner.goal?.kind === "chat" && partner.goal.partnerId === agent.id ? partner : undefined;
}

// The busy guy you're visiting, while he's still at his desk working.
function visitedAgent(state: OfficeState, agent: Agent): Agent | undefined {
  if (agent.goal?.kind !== "visit") {
    return undefined;
  }
  const agentId = agent.goal.agentId;
  const other = state.agents.find((candidate) => candidate.id === agentId);
  return other !== undefined && other.status === "working" && other.path.length === 0 && isAt(other, other.workSpot) ? other : undefined;
}

// Ends this guy's chat and frees his partner to do something else next frame.
function endChat(state: OfficeState, agent: Agent): void {
  if (agent.goal?.kind !== "chat") {
    return;
  }
  const partnerId = agent.goal.partnerId;
  agent.goal = undefined;
  const partner = state.agents.find((other) => other.id === partnerId);
  if (partner !== undefined && partner.goal?.kind === "chat" && partner.goal.partnerId === agent.id) {
    partner.goal = undefined;
    partner.target = undefined;
    partner.path = [];
    partner.modeUntil = state.time;
    if (partner.mode === "chat" || partner.mode === "wait" || partner.mode === "walk") {
      partner.mode = "loiter";
    }
  }
}

// A longer line stays up long enough to read, whatever the caller asked for.
function say(state: OfficeState, agent: Agent, text: string, seconds: number): void {
  agent.bubble = { text, until: state.time + (text.length > 8 ? Math.max(seconds, lineSeconds(text)) : seconds) };
}

// What an idle session guy (or you, on a break) is doing that he might say something to nobody about.
function museMode(agent: Agent): MuseMode | undefined {
  if (agent.status !== "idle" || agent.visitor !== undefined || agent.crew !== undefined || agent.leaving || agent.path.length > 0) {
    return undefined;
  }
  switch (agent.mode) {
    case "drink":
    case "couch":
    case "sit":
    case "stretch":
    case "loiter":
      return agent.mode;
    default:
      return undefined;
  }
}

// A chat line: a guy owed an answer gives it, a visitor makes small talk, a guy talking to a visitor answers in
// character, and everyone else chatters, now and then opening an exchange the other guy answers on his next turn.
function chatLine(state: OfficeState, speaker: Agent, listener: Agent | undefined, random: Random): string {
  const reply = speaker.reply;
  speaker.reply = undefined;
  if (reply !== undefined && state.time < reply.until) {
    return reply.text;
  }
  const talk = speaker.visitor?.smallTalk ?? [];
  if (talk.length > 0 && random() < 0.6) {
    return talk[Math.floor(random() * talk.length)];
  }
  if (speaker.visitor === undefined && listener?.visitor !== undefined && random() < 0.6) {
    return visitorReaction(personalityOf(speaker.seed), listener.visitor.boss, false, random) ?? chatPhrase(state.layout.scene, random);
  }
  const line = random() < 0.12 ? pickExchange(random) : chatPhrase(state.layout.scene, random);
  const answer = exchangeAnswer(line);
  if (answer !== undefined && listener !== undefined && listener.visitor === undefined) {
    listener.reply = { text: answer, until: state.time + 8 };
  }
  return line;
}

function removeAgent(state: OfficeState, agent: Agent): void {
  endChat(state, agent);
  state.agents = state.agents.filter((other) => other !== agent);
}

function here(agent: Agent): Point {
  return { x: Math.round(agent.x), y: Math.round(agent.y) };
}

function isAt(agent: Agent, point: Point): boolean {
  return Math.abs(agent.x - point.x) < 0.01 && Math.abs(agent.y - point.y) < 0.01;
}

function isTargeted(state: OfficeState, self: Agent, point: Point): boolean {
  return state.agents.some((other) => other !== self && other.target !== undefined && other.target.x === point.x && other.target.y === point.y);
}

function isWorkSpotOfOther(state: OfficeState, self: Agent, point: Point): boolean {
  return state.agents.some((other) => other !== self && other.workSpot.x === point.x && other.workSpot.y === point.y);
}

// ----- The maintenance crew -----

// Works out which desks need bringing in or taking out, sends the crew in when there's work, hands out jobs, and sends
// them home when it's all done.
function manageCrew(state: OfficeState, random: Random): void {
  const wanted = new Map<number, string>();
  for (const agent of state.agents) {
    if (isSession(agent) && !agent.leaving && agent.deskIndex !== undefined) {
      wanted.set(agent.deskIndex, agent.seed);
    }
  }
  let crew = crewAgents(state);
  const claimed = new Set(crew.flatMap((member) => (member.crew?.job === undefined ? [] : [member.crew.job.deskIndex])));
  const jobs: CrewJob[] = [];
  for (const [deskIndex, seed] of wanted) {
    if (!state.placed.has(deskIndex) && !claimed.has(deskIndex)) {
      jobs.push({ kind: "deliver", deskIndex, seed });
    }
  }
  for (const [deskIndex, seed] of state.placed) {
    if (!wanted.has(deskIndex) && !claimed.has(deskIndex)) {
      jobs.push({ kind: "remove", deskIndex, seed });
    }
  }
  if (jobs.length > 0 && crew.length === 0) {
    crew = CREW_IDS.map((id, index) => newCrew(state, id, index, random));
  }
  for (const member of crew) {
    const job = jobs[0];
    const free = member.crew !== undefined && member.crew.job === undefined && (member.crew.phase === "idle" || member.crew.phase === "out" || member.crew.phase === "help");
    if (job !== undefined && free && !(member.crew?.phase === "help" && member.crew.chair)) {
      jobs.shift();
      startJob(state, member, job, random);
    }
  }
}

function newCrew(state: OfficeState, id: string, index: number, random: Random): Agent {
  const agent: Agent = {
    ...newAgent(state, { id, seed: `crew|${index}`, status: "working", title: CREW_TITLE }, random),
    crew: { job: undefined, phase: "idle", carrying: undefined, chair: false },
  };
  state.agents.push(agent);
  // The second one follows a moment behind.
  setMode(state, agent, "loiter", index * 0.6);
  return agent;
}

function startJob(state: OfficeState, agent: Agent, job: CrewJob, random: Random): void {
  const crew = agent.crew as CrewState;
  crew.job = job;
  crew.chair = false;
  agent.leaving = false;
  if (job.kind === "remove") {
    crew.phase = "toSlot";
    say(state, agent, pickPhrase(CREW_REMOVE_LINES, random), 1.6);
    goTo(state, agent, state.layout.desks[job.deskIndex].seat, { kind: "crew" }, false, random);
    return;
  }
  crew.phase = "fetch";
  goTo(state, agent, state.layout.door, { kind: "crew" }, false, random);
}

function crewArrive(state: OfficeState, agent: Agent, random: Random): void {
  const crew = agent.crew as CrewState;
  const job = crew.job;
  switch (crew.phase) {
    case "fetch": {
      if (job === undefined) {
        crewDecide(state, agent, random);
        return;
      }
      // Picks up the desk at the door, and his partner grabs the chair if he's free.
      crew.carrying = job.seed;
      crew.phase = "toSlot";
      say(state, agent, pickPhrase(CREW_START_LINES, random), 1.6);
      goTo(state, agent, state.layout.desks[job.deskIndex].seat, { kind: "crew" }, false, random);
      const partner = crewAgents(state).find((other) => other !== agent && other.crew?.job === undefined && other.path.length === 0 && isAt(other, state.layout.door));
      if (partner?.crew !== undefined) {
        partner.crew.chair = true;
        helpPartner(state, partner, agent, random);
      }
      return;
    }
    case "toSlot":
      agent.facing = "up";
      if (job === undefined) {
        crewDecide(state, agent, random);
        return;
      }
      crew.phase = "build";
      say(state, agent, pickPhrase(CREW_BUILD_LINES, random), 1.2);
      setMode(state, agent, "build", between(random, 1.6, 2.4));
      return;
    case "haul":
      crew.carrying = undefined;
      crew.job = undefined;
      crew.phase = "idle";
      setMode(state, agent, "loiter", 0.3);
      return;
    case "help":
      agent.facing = agent.target === undefined ? "up" : facingToward(agent, partnerSpot(state, agent) ?? agent.target);
      setMode(state, agent, "loiter", 1);
      agent.nextBubbleAt = state.time + between(random, 0.5, 1.5);
      return;
    case "out":
      removeAgent(state, agent);
      return;
    default:
      setMode(state, agent, "loiter", 0.3);
  }
}

// Called when a crew member's mode runs out: finishes setting down or taking apart a desk, keeps standing by while his
// partner works, or heads out when there's nothing left.
function crewDecide(state: OfficeState, agent: Agent, random: Random): void {
  const crew = agent.crew as CrewState;
  const job = crew.job;
  agent.running = false;
  if (crew.phase === "build" && job !== undefined) {
    if (job.kind === "remove") {
      removeDesk(state, job.deskIndex);
      crew.carrying = job.seed;
      crew.phase = "haul";
      goTo(state, agent, state.layout.door, { kind: "crew" }, false, random);
      return;
    }
    const owner = state.agents.find((other) => isSession(other) && !other.leaving && other.deskIndex === job.deskIndex);
    if (owner === undefined) {
      // Nobody needs it anymore: back out it goes.
      say(state, agent, pickPhrase(CREW_NEVER_MIND_LINES, random), 1.4);
      crew.phase = "haul";
      goTo(state, agent, state.layout.door, { kind: "crew" }, false, random);
      return;
    }
    placeDesk(state, job.deskIndex, job.seed);
    crew.carrying = undefined;
    crew.job = undefined;
    crew.phase = "idle";
    say(state, agent, pickPhrase(CREW_DONE_LINES, random), 1.4);
    for (const other of crewAgents(state)) {
      if (other.crew?.phase === "help") {
        other.crew.chair = false;
        other.crew.phase = "idle";
      }
    }
    setMode(state, agent, "loiter", 0.6);
    return;
  }
  if ((crew.phase === "toSlot" || crew.phase === "fetch" || crew.phase === "haul") && job !== undefined) {
    // Interrupted on the way (pushed aside by a desk): carry on.
    const target = crew.phase === "toSlot" ? state.layout.desks[job.deskIndex].seat : state.layout.door;
    goTo(state, agent, target, { kind: "crew" }, false, random);
    return;
  }
  if (crew.phase === "help") {
    const partner = crewAgents(state).find((other) => other !== agent && other.crew?.job !== undefined);
    if (partner !== undefined) {
      setMode(state, agent, "loiter", 1);
      return;
    }
    crew.chair = false;
    crew.phase = "idle";
  }
  if (crew.phase === "out") {
    goTo(state, agent, state.layout.door, { kind: "crew" }, false, random);
    return;
  }
  // Nothing of his own: stand by a partner who's working, or go home once both are done.
  const partner = crewAgents(state).find((other) => other !== agent && other.crew?.job !== undefined);
  if (partner !== undefined) {
    helpPartner(state, agent, partner, random);
    return;
  }
  if (crewAgents(state).some((other) => other !== agent && other.crew?.phase === "build")) {
    setMode(state, agent, "loiter", 0.5);
    return;
  }
  crew.phase = "out";
  goTo(state, agent, state.layout.door, { kind: "crew" }, false, random);
}

function partnerSpot(state: OfficeState, agent: Agent): Point | undefined {
  const partner = crewAgents(state).find((other) => other !== agent && other.crew?.job !== undefined);
  const job = partner?.crew?.job;
  return job === undefined ? undefined : state.layout.desks[job.deskIndex]?.seat;
}

// Stands on an open tile beside the spot his partner is headed for.
function helpPartner(state: OfficeState, agent: Agent, partner: Agent, random: Random): void {
  const crew = agent.crew as CrewState;
  const job = partner.crew?.job;
  const spot = job === undefined ? undefined : state.layout.desks[job.deskIndex]?.seat;
  if (spot === undefined) {
    crew.phase = "idle";
    setMode(state, agent, "loiter", 0.5);
    return;
  }
  const owner = state.agents.find((other) => isSession(other) && other.deskIndex === job?.deskIndex);
  const waitSpot = owner === undefined ? undefined : deskWaitSpot(state, owner);
  const candidates = [
    { x: spot.x - 1, y: spot.y }, { x: spot.x + 1, y: spot.y },
    { x: spot.x - 1, y: spot.y + 1 }, { x: spot.x + 1, y: spot.y + 1 }, { x: spot.x, y: spot.y + 1 },
  ].filter((tile) =>
    state.layout.tiles[tile.y]?.[tile.x] === "floor" && !isTargeted(state, agent, tile) &&
    !(waitSpot !== undefined && tile.x === waitSpot.x && tile.y === waitSpot.y) &&
    !state.layout.desks.some((desk) => desk.desk.x === tile.x && desk.desk.y === tile.y),
  );
  crew.phase = "help";
  if (candidates.length === 0) {
    setMode(state, agent, "loiter", 1);
    return;
  }
  goTo(state, agent, candidates[Math.floor(random() * candidates.length)], { kind: "crew" }, false, random);
}

function facingToward(agent: Agent, point: Point): Facing {
  const dx = point.x - agent.x;
  const dy = point.y - agent.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
}

// ----- Shows -----

// A show comes to the Office: its performers walk in from the door to a stage near the middle of the room. Returns
// false when a show is already on, or there's no room for a stage.
export function startShow(state: OfficeState, input: ShowInput, random: Random): boolean {
  if (state.show !== undefined || input.performers.length === 0) {
    return false;
  }
  const stage = pickStage(state, input.performers.map((performer) => performer.role), random);
  if (stage === undefined) {
    return false;
  }
  const performers = input.performers.slice(0, stage.spots.length);
  const ids: string[] = [];
  performers.forEach((performer, index) => {
    const agent: Agent = {
      ...newAgent(state, { id: performer.id, seed: performer.seed, status: "working", title: performer.title }, random),
      performer: { role: performer.role, spot: stage.spots[index], bowing: false },
    };
    state.agents.push(agent);
    ids.push(agent.id);
    // They come in one after another.
    agent.goal = { kind: "perform" };
    setMode(state, agent, "loiter", index * 0.7);
  });
  state.show = {
    kind: input.kind,
    title: input.title,
    stage: stage.spots[0],
    spots: stage.spots.slice(0, performers.length),
    phase: "arriving",
    performerIds: ids,
    lines: input.lines,
    closer: input.closer,
    spoken: 0,
    nextLineAt: FOREVER,
    lineGap: 0,
    length: Math.max(5, input.length),
    startedAt: FOREVER,
    endsAt: FOREVER,
    giveUpAt: state.time + 30,
    nextGatherAt: FOREVER,
    food: input.food ?? [],
    lastCue: undefined,
  };
  return true;
}

// Ends the show now: the performers pack up and head out, and the crowd goes back to what it was doing.
export function endShow(state: OfficeState, random: Random): void {
  const show = state.show;
  if (show === undefined) {
    return;
  }
  state.show = undefined;
  for (const agent of [...state.agents]) {
    if (agent.performer !== undefined && show.performerIds.includes(agent.id)) {
      agent.performer.bowing = false;
      if (!agent.leaving) {
        leave(state, agent);
      }
    } else if (agent.goal?.kind === "show") {
      releaseWatcher(state, agent, random);
    }
  }
}

export function showPerformers(state: OfficeState): Agent[] {
  return state.agents.filter((agent) => agent.performer !== undefined);
}

function releaseWatcher(state: OfficeState, agent: Agent, random: Random): void {
  agent.goal = undefined;
  agent.target = undefined;
  agent.snack = undefined;
  agent.react = undefined;
  agent.cheerUntil = 0;
  // Stagger it, so the crowd doesn't move as one.
  setMode(state, agent, "loiter", between(random, 0.3, 2.5));
}

// Where the performers stand, in role order: the lead in the middle of a row, the others beside him, and the drummer
// behind. Picks open floor near the middle of the room, a little toward the back, with room for a crowd in front.
function pickStage(state: OfficeState, roles: readonly ShowRole[], random: Random): { spots: Point[] } | undefined {
  const { layout } = state;
  const deskTiles = new Set(layout.desks.flatMap((desk) => [desk.desk, desk.seat]).map((point) => `${point.x},${point.y}`));
  const open = (point: Point) => layout.tiles[point.y]?.[point.x] === "floor" && point.y >= 1 && !deskTiles.has(`${point.x},${point.y}`);
  const rowRoles = roles.filter((role) => role !== "drums");
  const hasDrums = roles.includes("drums");
  // Row offsets from the lead: 0, -1, +1, -2, +2.
  const offsets = rowRoles.map((_, index) => (index === 0 ? 0 : index % 2 === 1 ? -Math.ceil(index / 2) : Math.ceil(index / 2)));
  let best: { spots: Point[]; score: number } | undefined;
  for (const tile of openFloorTiles(layout)) {
    if (tile.y > layout.rows - 3) {
      continue;
    }
    const row = offsets.map((offset) => ({ x: tile.x + offset, y: tile.y }));
    if (!row.every(open)) {
      continue;
    }
    const drums = { x: tile.x, y: tile.y - 1 };
    const drumsFit = hasDrums && open(drums);
    const spotsByRole: Point[] = [];
    let rowIndex = 0;
    for (const role of roles) {
      if (role === "drums") {
        if (drumsFit) {
          spotsByRole.push(drums);
        }
      } else {
        spotsByRole.push(row[rowIndex++]);
      }
    }
    // Room for a crowd: open floor in the three rows in front of the stage.
    let crowdRoom = 0;
    for (let dy = 1; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (open({ x: tile.x + dx, y: tile.y + dy })) {
          crowdRoom += dy === 1 ? 1.2 : 1;
        }
      }
    }
    const score = Math.abs(tile.x - (layout.cols - 1) / 2) * 0.6 - crowdRoom + (hasDrums && !drumsFit ? 4 : 0) + random() * 0.5;
    if (best === undefined || score < best.score) {
      best = { spots: spotsByRole, score };
    }
  }
  return best;
}

// A spot in the crowd for this guy: open floor in front of the stage first, then beside it, never on stage.
function crowdSpot(state: OfficeState, agent: Agent, show: ShowState): Point | undefined {
  const { layout } = state;
  const deskTiles = new Set(layout.desks.flatMap((desk) => [desk.desk, desk.seat]).map((point) => `${point.x},${point.y}`));
  const taken = (point: Point) => show.spots.some((spot) => spot.x === point.x && spot.y === point.y) || isTargeted(state, agent, point);
  const near = PERFORMANCES[show.kind].effect === "food" ? 1 : 1.5;
  const spots = openFloorTiles(layout)
    .filter((tile) => tile.y >= 1 && !deskTiles.has(`${tile.x},${tile.y}`) && !taken(tile))
    .map((tile) => {
      const dx = tile.x - show.stage.x;
      const dy = tile.y - show.stage.y;
      const distance = Math.hypot(dx * 0.8, dy);
      return { tile, score: distance + (dy < 0 ? 3 : dy === 0 ? 1 : 0) + (distance < near ? 5 : 0) };
    })
    .filter(({ score }) => score < 9)
    .sort((first, second) => first.score - second.score);
  return spots[0]?.tile;
}

// Sends this guy to the crowd if a show is playing and he's free to watch. Returns false when there's nothing to join.
function joinShow(state: OfficeState, agent: Agent, random: Random): boolean {
  const show = state.show;
  if (show === undefined || show.phase !== "playing" || agent.leaving || agent.crew !== undefined || agent.performer !== undefined) {
    return false;
  }
  if (agent.goal?.kind === "show" || agent.status === "working" || isAddressing(agent)) {
    return agent.goal?.kind === "show";
  }
  const spot = crowdSpot(state, agent, show);
  if (spot === undefined) {
    return false;
  }
  endChat(state, agent);
  agent.watch = undefined;
  if (agent.mode === "sleep" && random() < 0.6) {
    say(state, agent, random() < 0.5 ? "huh? a show?" : "*yawn* …ooh!", 1.6);
  }
  goTo(state, agent, spot, { kind: "show" }, false, random);
  return true;
}

// Everyone free to watch heads for the crowd.
function gatherCrowd(state: OfficeState, random: Random): void {
  for (const agent of state.agents) {
    if (agent.goal?.kind !== "show" && (agent.status === "idle" || agent.status === "asleep") && agent.watch === undefined) {
      joinShow(state, agent, random);
    }
  }
}

function performerDecide(state: OfficeState, agent: Agent, random: Random): void {
  const show = state.show;
  const performer = agent.performer as PerformerState;
  if (show === undefined || !show.performerIds.includes(agent.id)) {
    leave(state, agent);
    return;
  }
  if (!isAt(agent, performer.spot)) {
    goTo(state, agent, performer.spot, { kind: "perform" }, false, random);
    return;
  }
  agent.facing = "down";
  setMode(state, agent, "perform", FOREVER);
}

function stepShow(state: OfficeState, random: Random): void {
  const show = state.show;
  if (show === undefined) {
    return;
  }
  const performers = show.performerIds
    .map((id) => state.agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => agent !== undefined && !agent.leaving);
  if (performers.length === 0) {
    endShow(state, random);
    return;
  }
  const lead = performers[0];
  if (show.phase === "arriving") {
    const ready = performers.every((agent) => agent.mode === "perform" && agent.path.length === 0);
    if (!ready && state.time < show.giveUpAt) {
      return;
    }
    show.phase = "playing";
    show.startedAt = state.time;
    show.endsAt = state.time + show.length;
    show.lineGap = show.length / Math.max(1, show.lines.length);
    show.nextLineAt = state.time + 1;
    show.nextGatherAt = state.time + 4;
    gatherCrowd(state, random);
    return;
  }
  if (show.phase === "playing") {
    if (state.time >= show.nextGatherAt) {
      // Anyone who just went idle or finished what he was doing comes over too.
      show.nextGatherAt = state.time + 4;
      gatherCrowd(state, random);
    }
    if (show.spoken < show.lines.length && state.time >= show.nextLineAt) {
      sayShowLine(state, show, lead, show.lines[show.spoken], random);
      show.spoken += 1;
      show.nextLineAt = state.time + show.lineGap;
    }
    if (state.time >= show.endsAt) {
      show.phase = "bows";
      show.endsAt = state.time + 4;
      sayShowLine(state, show, lead, show.closer, random);
      for (const agent of performers) {
        (agent.performer as PerformerState).bowing = true;
      }
    }
    return;
  }
  if (state.time >= show.endsAt) {
    endShow(state, random);
  }
}

function sayShowLine(state: OfficeState, show: ShowState, lead: Agent, line: ShowLine, random: Random): void {
  say(state, lead, line.text, Math.min(show.lineGap * 0.8, lineSeconds(line.text) + 0.5));
  if (line.cue === undefined) {
    return;
  }
  show.lastCue = { cue: line.cue, at: state.time };
  for (const agent of state.agents) {
    if (agent.mode !== "watch" || agent.goal?.kind !== "show") {
      continue;
    }
    const personality = personalityOf(agent.seed);
    // Most of the crowd answers out loud; the rest just cheer.
    const speaks = random() < 0.65;
    agent.react = {
      text: speaks ? audienceLine(show.kind, line.cue, personality, agent.status === "asleep", random, agent.snack) : "",
      at: state.time + between(random, 0.4, 1.3),
      cheer: line.cue !== "gasp" && (line.cue !== "laugh" || random() < 0.4),
    };
  }
}

// A guy in the crowd: answers the last cue, and now and then says something to nobody.
function stepWatcher(state: OfficeState, agent: Agent, random: Random): void {
  const show = state.show;
  if (show === undefined) {
    return;
  }
  const react = agent.react;
  if (react !== undefined && state.time >= react.at) {
    agent.react = undefined;
    if (react.text !== "") {
      say(state, agent, react.text, 1.8);
    }
    if (react.cheer) {
      agent.cheerUntil = state.time + between(random, 1.2, 2.2);
    }
    agent.nextBubbleAt = state.time + between(random, 4, 9);
    return;
  }
  if (state.time >= agent.nextBubbleAt && agent.bubble === undefined) {
    agent.nextBubbleAt = state.time + between(random, 6, 14);
    if (random() < 0.45) {
      say(state, agent, audienceLine(show.kind, "idle", personalityOf(agent.seed), agent.status === "asleep", random, agent.snack), 1.6);
    }
  }
}

function performerPose(agent: Agent, performer: PerformerState, time: number): AgentPose {
  if (performer.bowing) {
    return { pose: "cheer", facing: "down", frame: Math.floor(time * 3), seated: false };
  }
  switch (performer.role) {
    case "guitar":
    case "bass":
      // Strumming.
      return { pose: "build", facing: agent.facing, frame: Math.floor(time * 6), seated: false };
    case "drums":
    case "dj":
      return { pose: "build", facing: agent.facing, frame: Math.floor(time * 8), seated: false };
    case "cart":
      return { pose: agent.bubble === undefined ? "build" : "talk", facing: agent.facing, frame: Math.floor(time * (agent.bubble === undefined ? 2 : 5)), seated: false };
    default:
      return { pose: "talk", facing: agent.facing, frame: agent.bubble === undefined ? 0 : Math.floor(time * 5), seated: false };
  }
}
