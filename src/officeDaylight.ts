import type { OfficeSceneId } from "./officeLayout";

// Pure: the Office's sky and light for the real time of day. The sun follows your clock and the season,
// the moon follows its real phase, and each scene turns that into a sky color and a room tint.

const DEGREES = Math.PI / 180;
const SYNODIC_DAYS = 29.530588853;
// A known new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export interface SkyBody {
  // Degrees above the horizon; negative is below it.
  elevation: number;
  // Degrees from due south (north in the south): negative before it crosses, positive after.
  hourAngle: number;
}

export interface SkyState {
  sun: SkyBody;
  moon: SkyBody & {
    // 0 new, 0.5 full, back to 1.
    phase: number;
    // The lit fraction of the moon's face, 0-1.
    illumination: number;
  };
}

// Where you are isn't known, so this assumes a mid latitude: 40°N, or 35°S when your clock's
// daylight saving falls in January.
export function guessLatitude(date: Date): number {
  const january = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const july = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return january < july ? -35 : 40;
}

// The clock hour with daylight saving taken off, so noon is about when the sun is highest.
export function solarHour(date: Date): number {
  const standard = Math.max(new Date(date.getFullYear(), 0, 1).getTimezoneOffset(), new Date(date.getFullYear(), 6, 1).getTimezoneOffset());
  const saving = (standard - date.getTimezoneOffset()) / 60;
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 - saving;
}

export function dayOfYear(date: Date): number {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS);
}

export function solarDeclination(day: number): number {
  return -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
}

export function elevation(latitude: number, declination: number, hourAngle: number): number {
  const sine = Math.sin(latitude * DEGREES) * Math.sin(declination * DEGREES)
    + Math.cos(latitude * DEGREES) * Math.cos(declination * DEGREES) * Math.cos(hourAngle * DEGREES);
  return Math.asin(Math.max(-1, Math.min(1, sine))) / DEGREES;
}

export function moonPhase(time: number): number {
  const cycles = (time - NEW_MOON_MS) / DAY_MS / SYNODIC_DAYS;
  return cycles - Math.floor(cycles);
}

// Wraps an angle to -180..180.
function wrap(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

// The sun and moon for a solar hour, day of the year, and latitude. The moon runs behind the sun by its
// phase (a full moon rises at sunset) and sits on the far side of the sky from it when full.
export function skyAt(hour: number, day: number, latitude: number, phase: number): SkyState {
  const declination = solarDeclination(day);
  const sunAngle = wrap((hour - 12) * 15);
  const moonAngle = wrap(sunAngle - phase * 360);
  const moonDeclination = declination * Math.cos(2 * Math.PI * phase);
  return {
    sun: { elevation: elevation(latitude, declination, sunAngle), hourAngle: sunAngle },
    moon: {
      elevation: elevation(latitude, moonDeclination, moonAngle),
      hourAngle: moonAngle,
      phase,
      illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2,
    },
  };
}

export function skyNow(date: Date): SkyState {
  const day = dayOfYear(date);
  return skyAt(solarHour(date) + equationOfTime(day) / 60, day, guessLatitude(date), moonPhase(date.getTime()));
}

// Minutes the sun runs ahead of the clock through the year (up to 16 in November, 14 behind in February).
export function equationOfTime(day: number): number {
  const angle = (2 * Math.PI * (day - 81)) / 364;
  return 9.87 * Math.sin(2 * angle) - 7.53 * Math.cos(angle) - 1.5 * Math.sin(angle);
}

// The fixed sky when the day and night cycle is off: mid-morning, no moon.
export const DAYTIME_SKY: SkyState = skyAt(10.5, 172, 40, 0);

export interface SceneLight {
  // The color the whole room is multiplied by; white is full daylight.
  ambient: string;
  // How dark the room is, 0 (day) to 0.8 (deep night). Lamps and screens glow by this much.
  darkness: number;
  // The color of open sky, for windows and the field.
  sky: string;
  // How bright the stars are, 0-1.
  stars: number;
  // Clouds: white by day, lit by the sunset, grey-blue at night.
  cloud: string;
  // The sun's color, warmer near the horizon.
  sun: string;
}

type Stop = [elevation: number, color: string];

// Sky colors by the sun's elevation, high to low.
const SKY_STOPS: Stop[] = [
  [60, "#79C6F0"],
  [20, "#8FD3F4"],
  [7, "#B4DCEC"],
  [2, "#F4C28E"],
  [-1.5, "#E48A68"],
  [-4.5, "#8C5F8E"],
  [-8, "#3D4278"],
  [-13, "#1C2444"],
  [-90, "#111830"],
];

// The room's tint by the sun's elevation: golden hour, sunset, blue hour, night.
const AMBIENT_STOPS: [elevation: number, color: string, strength: number][] = [
  [12, "#FFFFFF", 0],
  [5, "#FFD6A0", 0.2],
  [0.5, "#FF9C6C", 0.34],
  [-3.5, "#9C78B0", 0.5],
  [-7.5, "#3E4E96", 0.68],
  [-13, "#1C2560", 0.8],
];

// How much each scene follows the sky. Indoors the lights are on; the server room and the cave never see it.
const SCENE_EXPOSURE: Record<OfficeSceneId, number> = {
  office: 0.32,
  serverRoom: 0,
  forest: 1,
  field: 1,
  riverbed: 1,
  cave: 0,
  moon: 1,
};

export function sceneLight(scene: OfficeSceneId, sky: SkyState): SceneLight {
  const sunUp = sky.sun.elevation;
  const exposure = SCENE_EXPOSURE[scene];
  if (scene === "moon") {
    return moonLight(sky);
  }
  const [tint, strength] = ambientAt(sunUp);
  const darkness = strength * exposure;
  const skyColor = colorAt(SKY_STOPS, sunUp);
  return {
    ambient: mix("#FFFFFF", tint, darkness),
    darkness,
    sky: skyColor,
    cloud: mix(skyColor, "#FFFFFF", 0.18 + 0.72 * clamp((sunUp + 6) / 16)),
    stars: clamp((-sunUp - 4) / 8),
    sun: mix("#FFE066", "#FF7B3A", clamp((8 - sunUp) / 9)),
  };
}

// No air on the moon: no colored dusk, the sun is up or it isn't. A lunar day lasts a month and follows the
// moon's phase; at night the Earth, full when the moon is new, lights the ground a little.
function moonLight(sky: SkyState): SceneLight {
  const sunUp = lunarSunElevation(sky.moon.phase);
  const earthLit = earthIllumination(sky.moon.phase);
  const night = clamp((2 - sunUp) / 4);
  const darkness = night * (0.66 - 0.22 * earthLit);
  return { ambient: mix("#FFFFFF", "#3A4670", darkness), darkness, sky: "#05060C", stars: 1, cloud: "#FFFFFF", sun: "#FFF6E0" };
}

// The sun's height over the middle of the moon's near side: noon at full moon, midnight at new moon.
export function lunarSunElevation(phase: number): number {
  return 90 * Math.sin(2 * Math.PI * (phase - 0.25));
}

// From the moon, the Earth's lit fraction is the opposite of the moon's.
export function earthIllumination(phase: number): number {
  return (1 + Math.cos(2 * Math.PI * phase)) / 2;
}

function ambientAt(sunUp: number): [string, number] {
  const stops = AMBIENT_STOPS;
  if (sunUp >= stops[0][0]) {
    return [stops[0][1], 0];
  }
  for (let index = 1; index < stops.length; index++) {
    const [high, highColor, highStrength] = stops[index - 1];
    const [low, lowColor, lowStrength] = stops[index];
    if (sunUp >= low) {
      const amount = (high - sunUp) / (high - low);
      return [mix(highColor, lowColor, amount), highStrength + (lowStrength - highStrength) * amount];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2]];
}

function colorAt(stops: Stop[], sunUp: number): string {
  if (sunUp >= stops[0][0]) {
    return stops[0][1];
  }
  for (let index = 1; index < stops.length; index++) {
    const [high, highColor] = stops[index - 1];
    const [low, lowColor] = stops[index];
    if (sunUp >= low) {
      return mix(highColor, lowColor, (high - sunUp) / (high - low));
    }
  }
  return stops[stops.length - 1][1];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Blends two #RRGGBB colors: 0 is the first, 1 the second.
export function mix(first: string, second: string, amount: number): string {
  const a = parseInt(first.slice(1), 16);
  const b = parseInt(second.slice(1), 16);
  const t = clamp(amount);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1).toUpperCase()}`;
}

// Whether a pixel of a disc of radius 1 is lit, for drawing the moon and the Earth's phases.
// x and y run -1..1; waxing lights the right side first.
export function discLit(x: number, y: number, illumination: number, waxing: boolean): boolean {
  const half = Math.sqrt(Math.max(0, 1 - y * y));
  const edge = (1 - 2 * illumination) * half;
  return waxing ? x >= edge : -x >= edge;
}
