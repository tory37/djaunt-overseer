// Pure: the Office view's people. Each live session gets a guy with a desk. A working session's guy sits at his desk
// and types; an idle one sits back, then wanders off: the cooler, the coffee, the couch, a walk, or a chat with
// another idle guy. When his session gets busy again he runs back to his desk. A suspended session's guy goes back to
// his desk and falls asleep on it. A session that leaves the sidebar walks out the door.
// You're in the room too, at your station: you work, take a break now and then to wander, grab a coffee, or shoot
// the breeze with someone (idle, or busy at his desk), and run back to your desk when a scene event hits.
// The webview calls syncOffice when the sessions change, syncYou when you come or go, and stepOffice every frame;
// time is in seconds.

import { DRINK_PROPS, findPath, isWalkable, nearestWalkable, OfficeLayout, openFloorTiles, Point } from "./officeLayout";
import type { Facing, Pose } from "./pixelGuy";

export type AgentStatus = "working" | "idle" | "asleep";

export interface AgentInput {
  id: string;
  seed: string;
  status: AgentStatus;
  title: string;
}

export type AgentMode = "walk" | "type" | "sit" | "stretch" | "drink" | "loiter" | "chat" | "wait" | "couch" | "sleep";

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
}

export interface OfficeState {
  layout: OfficeLayout;
  agents: Agent[];
  time: number;
}

export type Random = () => number;

const WALK_SPEED = 2.4;
const RUN_SPEED = 5.5;
const FOREVER = Number.POSITIVE_INFINITY;
const CHAT_WAIT_SECONDS = 10;

const CHATTER = ["!", "?", "#", "@", "$", "%", "&", "*", "♪", "…", "^_^", "o_O", "lol", "?!", "<3", "☕", "★", "~"];
const CODE_CHATTER = ["{ }", "</>", "=>", "[ ]", "0x", "#!", "&&", ";", "//", "++"];

export const YOU_AGENT_ID = "you";
const BREAK_LINES = ["brb", "coffee?", "☕", "stretch", "…", "sup"];
const BACK_LINES = ["ok ok", "back to it", "♪", "…"];

const between = (random: Random, low: number, high: number) => low + random() * (high - low);

export function createOffice(layout: OfficeLayout): OfficeState {
  return { layout, agents: [], time: 0 };
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
    if (agent.you) {
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
  const known = new Set(state.agents.filter((agent) => !agent.you).map((agent) => agent.id));
  const newcomers = inputs.filter((input) => !known.has(input.id)).map((input) => newAgent(state, input, random));
  state.agents.push(...newcomers);
  assignWorkSpots(state);
  for (const agent of newcomers) {
    if (entrance === "seated") {
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
    say(state, agent, BREAK_LINES[Math.floor(random() * BREAK_LINES.length)], 1.4);
    pickIdleActivity(state, agent, random);
    return;
  }
  endChat(state, agent);
  agent.status = "working";
  agent.nextBreakAt = state.time + between(random, 45, 100);
  say(state, agent, BACK_LINES[Math.floor(random() * BACK_LINES.length)], 1.4);
  goTo(state, agent, agent.workSpot, { kind: "work" }, false, random);
}

// Swaps in a new floor plan after a resize, keeps desks where it can, and has everyone pick up again from where they are.
export function relayoutOffice(state: OfficeState, layout: OfficeLayout, random: Random): void {
  state.layout = layout;
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
  for (const agent of state.agents) {
    if (agent.leaving) {
      leave(state, agent);
    } else {
      decide(state, agent, random);
    }
  }
}

export function stepOffice(state: OfficeState, seconds: number, random: Random): void {
  const dt = Math.max(0, Math.min(seconds, 0.25));
  state.time += dt;
  for (const agent of [...state.agents]) {
    if (agent.bubble !== undefined && state.time >= agent.bubble.until) {
      agent.bubble = undefined;
    }
    if (agent.you) {
      stepYou(state, agent, random);
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
    if (agent.mode === "chat" && state.time >= agent.nextBubbleAt) {
      // At a busy guy's desk, he answers over his shoulder about half the time.
      const speaker = visited !== undefined && visited.bubble === undefined && random() < 0.45 ? visited : agent;
      say(state, speaker, chatter(random), between(random, 1, 1.8));
      agent.nextBubbleAt = state.time + between(random, 1.6, 3.4);
    }
    if (agent.mode === "type" && state.time >= agent.nextBubbleAt) {
      if (random() < 0.35) {
        say(state, agent, CODE_CHATTER[Math.floor(random() * CODE_CHATTER.length)], 1.4);
      }
      agent.nextBubbleAt = state.time + between(random, 10, 25);
    }
    if (state.time >= agent.modeUntil) {
      decide(state, agent, random);
    }
  }
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
  if (agent.path.length > 0) {
    return { pose: "walk", facing: agent.facing, frame: Math.floor(time * (agent.running ? 12 : 7)), seated: false };
  }
  switch (agent.mode) {
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
      return { pose: "talk", facing: agent.facing, frame: agent.bubble === undefined ? 0 : Math.floor(time * 5), seated: false };
    default:
      return { pose: "stand", facing: agent.facing, frame: 0, seated: false };
  }
}

export function officeCounts(state: OfficeState): { working: number; idle: number; asleep: number } {
  const present = state.agents.filter((agent) => !agent.leaving && !agent.you);
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
  };
}

// Keeps each guy's desk if it still exists, hands free desks out in order, then couch seats, then open floor.
function assignWorkSpots(state: OfficeState): void {
  const { desks, couchSeats } = state.layout;
  for (const agent of state.agents) {
    if (agent.you) {
      agent.deskIndex = undefined;
      agent.workSpot = state.layout.station?.seat ?? state.layout.door;
    }
  }
  const present = state.agents.filter((agent) => !agent.leaving && !agent.you);
  const takenDesks = new Set<number>();
  for (const agent of present) {
    if (agent.deskIndex !== undefined && !takenDesks.has(agent.deskIndex) && agent.deskIndex < desks.length) {
      takenDesks.add(agent.deskIndex);
    } else {
      agent.deskIndex = undefined;
    }
  }
  const freeDesks = desks.map((_, index) => index).filter((index) => !takenDesks.has(index));
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
    say(state, agent, agent.status === "working" ? "!?" : "~", 1.4);
  }
  if (agent.status === "asleep") {
    say(state, agent, "*yawn*", 1.6);
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
      say(state, agent, "!", 1);
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
  if (agent.leaving) {
    leave(state, agent);
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
  const atDesk = agent.deskIndex !== undefined && agent.path.length === 0 && isAt(agent, agent.workSpot);
  const freeProps = state.layout.props
    .map((prop, propIndex) => ({ prop, propIndex }))
    .filter(({ prop }) => prop.stand !== undefined && !isTargeted(state, agent, prop.stand));
  const freeCouch = state.layout.couchSeats.filter((seat) => !isTargeted(state, agent, seat) && !isWorkSpotOfOther(state, agent, seat));
  const partners = state.agents.filter((other) => other !== agent && canChat(other));
  const options: { weight: number; run: () => void }[] = [
    { weight: 2, run: () => wander(state, agent, random) },
  ];
  if (agent.deskIndex !== undefined && !atDesk) {
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
  if (partners.length > 0) {
    options.push({ weight: agent.you ? 6 : 3, run: () => startChat(state, agent, partners[Math.floor(random() * partners.length)], random) });
  }
  if (agent.you) {
    const visits = state.agents
      .filter((other) => other !== agent && other.status === "working" && other.deskIndex !== undefined && other.mode === "type" && other.path.length === 0)
      .map((other) => ({ other, spot: { x: other.workSpot.x, y: other.workSpot.y + 1 } }))
      .filter(({ spot }) => state.layout.tiles[spot.y]?.[spot.x] === "floor" && !isTargeted(state, agent, spot));
    if (visits.length > 0) {
      options.push({
        weight: 6,
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
  return !agent.leaving && agent.status === "idle" && agent.goal?.kind !== "chat" && agent.mode !== "chat" && agent.mode !== "wait";
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

function say(state: OfficeState, agent: Agent, text: string, seconds: number): void {
  agent.bubble = { text, until: state.time + seconds };
}

function chatter(random: Random): string {
  const count = 1 + Math.floor(random() * 3);
  return Array.from({ length: count }, () => CHATTER[Math.floor(random() * CHATTER.length)]).join(" ");
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
