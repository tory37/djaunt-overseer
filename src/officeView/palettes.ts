import type { OfficeSceneId } from "../officeLayout";

// Fixed pixel-art colors per scene. They don't follow the editor theme on purpose: the room is a picture.
export interface ScenePalette {
  floor: string;
  floorAlt: string;
  floorLine: string;
  planks: boolean;
  shadow: string;
  wall: string;
  wallTrim: string;
  windows: boolean;
  windowFrame: string;
  door: string;
  doorFrame: string;
  monitor: string;
  screenOn: string;
  screenIdle: string;
  screenOff: string;
  code: string[];
  deskTop: string;
  deskFront: string;
  keyboard: string;
  mug: string;
  chair: string;
  chairLight: string;
  chairLeg: string;
  pot: string;
  couch: string;
  couchLight: string;
  bubble: string;
  bubbleEdge: string;
  bubbleText: string;
}

export const SCENE_PALETTES: Record<OfficeSceneId, ScenePalette> = {
  office: {
    floor: "#C9A26B",
    floorAlt: "#C29B64",
    floorLine: "#A9824F",
    planks: true,
    shadow: "rgba(0,0,0,0.18)",
    wall: "#E9DFC9",
    wallTrim: "#B5A283",
    windows: true,
    windowFrame: "#F7F3EA",
    door: "#8B5A2B",
    doorFrame: "#5E3B1B",
    monitor: "#2B2B33",
    screenOn: "#1C2B3A",
    screenIdle: "#202833",
    screenOff: "#111317",
    code: ["#7FD1FF", "#F3A712", "#4CB944", "#F06595", "#E9ECEF"],
    deskTop: "#9C6B3C",
    deskFront: "#7A4E26",
    keyboard: "#D9D9DE",
    mug: "#E4572E",
    chair: "#3B3B48",
    chairLight: "#55556A",
    chairLeg: "#26262E",
    pot: "#B5562F",
    couch: "#4C6EF5",
    couchLight: "#7591F7",
    bubble: "#FFFFFF",
    bubbleEdge: "#2B2B33",
    bubbleText: "#1A1A2E",
  },
  serverRoom: {
    floor: "#2A2F3A",
    floorAlt: "#272C36",
    floorLine: "#363D4B",
    planks: false,
    shadow: "rgba(0,0,0,0.35)",
    wall: "#1A1E26",
    wallTrim: "#3A4150",
    windows: false,
    windowFrame: "#3A4150",
    door: "#4A5262",
    doorFrame: "#2C323D",
    monitor: "#14171D",
    screenOn: "#0B1F12",
    screenIdle: "#0E1712",
    screenOff: "#08090B",
    code: ["#3DDC6A", "#8EF5A8", "#4FC3F7", "#F1C24B"],
    deskTop: "#4A5262",
    deskFront: "#353B47",
    keyboard: "#8590A3",
    mug: "#4FC3F7",
    chair: "#20242C",
    chairLight: "#3A4150",
    chairLeg: "#111317",
    pot: "#3A4150",
    couch: "#7950F2",
    couchLight: "#9775FA",
    bubble: "#0B1F12",
    bubbleEdge: "#3DDC6A",
    bubbleText: "#8EF5A8",
  },
};
