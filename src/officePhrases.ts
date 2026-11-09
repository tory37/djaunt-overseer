import type { OfficeSceneId } from "./officeLayout";

// Pure: what the Office's guys say in their bubbles. Chat between two guys, back-and-forth exchanges, chat that fits
// the scene, mutters while typing, musings while idle, your breaks, sleeping and waking, and the maintenance crew.
// Visitors, events, critters, and fliers keep their own lines in their own modules.

export type Random = () => number;

export function pickPhrase(list: readonly string[], random: Random): string {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

// Quick noises: a chat is mostly these, strung one to three at a time.
export const CHATTER_SYMBOLS: readonly string[] = ["!", "?", "#", "@", "$", "%", "&", "*", "♪", "…", "^_^", "o_O", "lol", "?!", "<3", "☕", "★", "~"];

// Small talk between two guys, anywhere.
export const CHAT_LINES: readonly string[] = [
  "lol", "no way", "for real?", "same", "big if true", "classic", "wild", "true true", "haha", "mood", "oof", "yikes",
  "it's fine", "it's not fine", "huh", "totally", "nah", "eh", "say less", "brb", "makes sense", "I'll allow it",
  "it works on my machine", "did you push?", "who broke main?", "is it Friday yet?", "tabs or spaces?", "spaces. obviously.",
  "I miss jQuery", "rewrite it in Rust", "have you tried Vim?", "how do I exit Vim", "it's always DNS", "never DNS. until it is.",
  "that's a feature", "ship it", "LGTM", "nit:", "one more meeting", "this could've been an email", "standup ran long",
  "my code works. no idea why", "it doesn't work. no idea why", "it compiled first try", "suspicious", "who wrote this?",
  "oh. me.", "git blame says me", "legacy code is my cardio", "I named a variable 'thing2'", "naming is hard",
  "cache invalidation tho", "off by one again", "off by two this time", "I have 47 tabs open", "my RAM is crying",
  "I deployed on Friday", "you monster", "the tests pass", "which tests?", "the ones I didn't skip", "it's 90% done",
  "the other 90% though", "should be quick", "famous last words", "I'll fix it in post", "TODO: fix later", "later never came",
  "the AI wrote that", "the AI fixed that", "the AI broke that", "prompt engineering is my passion", "did you clear the cache?",
  "is the build green?", "it's yellow?", "the coffee machine is down", "worst day ever", "who took my stapler",
  "my mouse died", "it's a USB-C thing", "need a dongle", "my dongle needs a dongle", "the wifi's haunted",
  "standup in 5", "I'm on mute", "you're on mute", "can you see my screen?", "next slide please", "we're at time",
  "anyway", "where was I", "lost my train of thought", "choo choo", "nice shirt", "nice keyboard", "it's mechanical",
  "I can hear it from here", "clicky clicky", "lunch?", "tacos?", "always tacos", "is there cake?", "the cake is a lie",
  "weekend plans?", "sleep. mostly.", "touch grass", "what's grass", "read any good docs?", "docs? lol",
  "I wrote docs once", "nobody read them", "my plant is thriving", "mine died", "it was plastic", "how?",
  "I have a theory", "it's aliens", "it's always aliens", "pair on it?", "rubber duck it", "the duck knows",
  "I talked to the duck", "the duck said no", "100% coverage", "of one file", "it's a monorepo", "it's a mono-mess",
  "merge conflict again", "I chose 'theirs'", "bold", "rebase or merge?", "yes", "regex time", "now two problems",
];

// A line and the answer the other guy gives on his next turn.
export const CHAT_EXCHANGES: readonly (readonly [string, string])[] = [
  ["knock knock", "who's there?"],
  ["tabs or spaces?", "don't start"],
  ["did you push?", "…define push"],
  ["who broke the build?", "not me"],
  ["coffee?", "always"],
  ["lunch?", "yes. now."],
  ["is it Friday?", "spiritually"],
  ["you look tired", "I'm a dev"],
  ["can I ask a dumb question?", "my favorite kind"],
  ["it works!", "don't touch it"],
  ["I'm refactoring", "godspeed"],
  ["got a minute?", "it's never a minute"],
  ["I fixed the bug", "which one?"],
  ["I love meetings", "blink twice"],
  ["hot take", "go on"],
  ["want to pair?", "pear 🍐"],
  ["do you even lift?", "only exceptions"],
  ["what's a monad?", "nobody knows"],
  ["is this a bug?", "it's a surprise feature"],
  ["I'm in the zone", "don't let me break it"],
  ["deploy on Friday?", "absolutely not"],
  ["how's the backlog?", "load-bearing"],
  ["guess what", "chicken butt"],
  ["we should rewrite it", "we should not"],
  ["why is it slow?", "N+1"],
  ["git push --force?", "NO"],
  ["sudo make me a sandwich", "okay."],
  ["any blockers?", "only you"],
  ["ping", "pong"],
  ["marco", "polo"],
  ["it's a one-liner", "a 400 char one-liner"],
  ["did you test it?", "in prod"],
  ["where's the bug?", "between chair and keyboard"],
  ["what's the ETA?", "soon™"],
];

// Chat that fits where the room is.
export const SCENE_CHAT: Record<OfficeSceneId, readonly string[]> = {
  office: [
    "who moved my chair?", "printer's jammed again", "PC LOAD LETTER?!", "the cat clock is staring", "is the fridge clean?",
    "someone ate my yogurt", "it had my NAME on it", "AC's too cold", "AC's too hot", "fire drill again?", "nice view",
    "the elevator smells", "free bagels!", "the good mugs are gone", "who's on the couch?", "plant needs water",
  ],
  serverRoom: [
    "it's loud in here", "what?", "WHAT?", "so many blinky lights", "is that one smoking?", "rack 4 is humming",
    "don't trip on the cable", "which cable?", "all of them", "it's freezing", "feels like a fridge", "the fans!!",
    "label your cables", "who unplugged that?", "the server is the heater", "uptime: 400 days", "don't jinx it",
  ],
  forest: [
    "did you hear that?", "is that a bear?", "it's a stick", "the wifi is bad", "the vibes are good", "smells like pine",
    "mosquito!", "I'm one with nature", "nature has no outlets", "where's the trail?", "we're lost", "we're coding in a forest",
    "tree-shaking!", "binary tree?", "log file. get it?", "a real bug!", "this is my branch",
  ],
  field: [
    "so much sky", "sunscreen?", "is that a cow?", "the grass is green", "touched grass", "the breeze!", "hay fever…",
    "nice day for it", "I'm a field engineer now", "cloud computing!", "it's an actual cloud", "how far is the fridge?",
    "picnic standup?", "farm to table code", "free-range functions",
  ],
  riverbed: [
    "smells like river", "my feet are wet", "rock skipping later?", "is the laptop waterproof?", "it is not",
    "data stream!", "upstream changes", "go with the flow", "the fish judge me", "it's very calming", "splash!",
    "stream processing", "who's fishing?", "found a cool rock", "pebble",
  ],
  cave: [
    "echo!", "echo… echo…", "it's dark", "is that a dragon?", "don't wake it", "I see gold", "don't touch the gold",
    "bats?", "spelunking!", "deep in the stack", "no wifi down here", "dripping…", "torch's running low",
    "dungeon crawl", "loot!", "roll for initiative",
  ],
  moon: [
    "one small commit", "the ping is 2.6 seconds", "low gravity!", "boing", "is that Earth?", "hi mom!", "it's so quiet",
    "where's the air?", "moon cheese?", "it's rock", "my helmet's foggy", "remote work, but further", "houston?",
    "space latency", "the view though", "zero G coffee", "I'm floating",
  ],
  beach: [
    "sand in my keyboard", "sunscreen?", "surf's up", "glare on my screen", "is that a crab?", "beach day!",
    "the tide's coming in", "wifi's bad out here", "salty air", "who brought snacks?", "sandcastle standup",
    "wave-driven development", "my laptop is hot", "shell scripting", "out of office. literally.",
  ],
  snowfield: [
    "it's freezing", "my fingers!", "brr", "snow day!", "can't feel my toes", "is that a penguin?",
    "hot cocoa?", "snowball fight!", "frozen build", "the code froze", "cold start", "ice ice baby",
    "let it snow", "a cold deploy", "who left the door open?",
  ],
  desert: [
    "it's so hot", "water?", "is that a mirage?", "dry spell", "sand everywhere", "my laptop is melting",
    "tumbleweed…", "where's the shade?", "it's a dry heat", "cactus!", "heatwave deploy", "hot fix!",
    "the CPU is cooking", "camel case", "thirsty",
  ],
  reef: [
    "blub", "is my laptop waterproof?", "fish!", "deep dive", "it's so blue", "bubbles!", "the coral!",
    "swim lane", "under the sea", "low latency, high pressure", "sea-plus-plus", "stay hydrated",
    "watch the jellies", "I'm a deep-sea dev", "nice reef",
  ],
  library: [
    "shhh", "SHHH", "the books!", "overdue", "so quiet", "read the docs", "RTFM", "where's the manual?",
    "that one flew", "dewey decimal", "library code!", "checked out", "no talking", "nice reading nook",
    "the docs are outdated",
  ],
  rooftop: [
    "nice view", "it's windy", "don't look down", "pigeons!", "sunset standup", "the city!",
    "is that a helicopter?", "rooftop deploy", "top-level code", "high availability", "cloud computing!",
    "who's grilling?", "my notes blew away", "good signal up here", "up on the roof",
  ],
};

// Mutters while typing: mostly code bits, sometimes a word.
export const TYPING_LINES: readonly string[] = [
  "{ }", "</>", "=>", "[ ]", "0x", "#!", "&&", ";", "//", "++", "!=", "===", "λ", "()", "**", "::", "?.", "??",
  "hmm", "huh", "wait", "why", "oh no", "oh yes", "ahh", "ok ok ok", "it compiles!", "it runs!", "it… ran?",
  "one more test", "almost…", "where's that semicolon", "console.log('here')", "console.log('here2')", "why is this null",
  "undefined?!", "who wrote this", "me. I wrote this", "TODO", "FIXME", "// don't touch", "rm -rf node_modules",
  "npm install…", "still installing", "works locally", "stack overflow it", "regex…", "it's a one-liner", "refactor!",
  "delete delete delete", "-200 lines", "+3000 lines", "git commit -m 'stuff'", "wip", "wip2", "final_final",
  "ctrl+z ctrl+z", "save. save!", "*clack clack*", "*types furiously*", "yes YES", "flow state", "beep boop",
];

// What an idle guy says to nobody, by what he's doing.
export type MuseMode = "drink" | "couch" | "sit" | "stretch" | "loiter";

export const MUSE_LINES: Record<MuseMode, readonly string[]> = {
  drink: [
    "☕", "ahh", "sip", "*slurp*", "coffee #4", "coffee #5", "this is decaf?!", "who made this", "liquid code",
    "hydrate!", "just water", "it's cold", "needs more sugar", "mmm", "fuel", "caffeine: online",
  ],
  couch: [
    "comfy", "5 min nap", "*sinks in*", "I live here now", "never getting up", "this couch knows me", "zz… no",
    "thinking. not napping.", "deep thoughts", "*scrolls phone*", "lol", "ok one more video", "found a coin",
  ],
  sit: [
    "hmm", "…", "thinking", "waiting on CI", "CI's slow", "waiting on review", "any second now", "*spins chair*",
    "wheee", "*leans back*", "did I lock my screen?", "what was I doing", "let it cook", "it's compiling",
  ],
  stretch: [
    "*stretch*", "*crack*", "ow my back", "posture check", "*yawn*", "need a walk", "my legs!", "*pop*",
    "ergonomics", "ahh", "I'm 30 going on 80",
  ],
  loiter: [
    "la la la", "♪", "♪♫", "*whistles*", "hmm", "where was I going", "why'd I come here", "nice floor", "just walking",
    "steps!", "10k steps", "lap 3", "patrolling", "*wanders*", "anyone seen my mug?", "what's this", "ooh",
  ],
};

// Your guy, getting up for a break, and back to it.
export const BREAK_LINES: readonly string[] = [
  "brb", "coffee?", "☕", "stretch", "…", "sup", "break time", "need a walk", "5 min", "eyes hurt", "snack run",
  "touching grass", "brain's full", "one sec", "AFK", "let it build", "who's around?",
];
export const BACK_LINES: readonly string[] = [
  "ok ok", "back to it", "♪", "…", "alright", "focus", "where was I", "refreshed", "let's go", "round 2",
  "back!", "time to ship", "ok, for real now",
];

// A guy running back because his session got busy again.
export const RUSH_LINES: readonly string[] = ["!", "!", "!", "oh!", "on it!", "coming!", "new prompt!", "brb!", "gotta go", "!!", "work!"];

// Going to sleep (his session was suspended), and waking up.
export const SLEEP_LINES: readonly string[] = ["*yawn*", "*yawn*", "5 more min", "nap time", "zzz…", "night", "suspended…", "brb (sleep)"];
export const WAKE_TO_WORK_LINES: readonly string[] = ["!?", "huh?!", "I'm up!", "wasn't sleeping", "what'd I miss", "!", "on it!"];
export const WAKE_IDLE_LINES: readonly string[] = ["~", "*yawn*", "mm?", "huh", "morning", "*blinks*", "…"];

// The maintenance crew.
export const CREW_START_LINES: readonly string[] = [
  "comin' through!", "mind your backs", "desk delivery", "where's this one go?", "watch the corners", "beep beep",
  "heavy load!", "make way!", "who ordered a desk?", "desk for…? this guy?", "pivot!", "PIVOT!",
];
export const CREW_BUILD_LINES: readonly string[] = [
  "*clank*", "*bonk bonk*", "*whirr*", "*tap tap*", "*screech*", "*drill*", "*clunk*", "where's the allen key",
  "extra screws?", "one leftover screw", "it's fine", "*hammer*",
];
export const CREW_DONE_LINES: readonly string[] = [
  "all yours", "there ya go", "done!", "enjoy", "sturdy!", "don't lean on it", "warranty's void", "sign here",
  "five stars?", "good as new", "mostly level",
];
export const CREW_REMOVE_LINES: readonly string[] = [
  "this one's going", "*grunt*", "outta here", "heavy one", "bye desk", "to the desk farm", "it had a good run",
  "anyone want a desk?", "found gum under it", "found a sandwich",
];
export const CREW_HELP_LINES: readonly string[] = [
  "left a bit", "lift with your legs", "careful!", "little more…", "^_^", "looks good", "your left", "MY left",
  "is it level?", "close enough", "hold it", "steady…", "*holds chair*", "nice",
];
export const CREW_NEVER_MIND_LINES: readonly string[] = ["never mind", "wrong room?", "uh. ok.", "back it goes", "*sigh*"];

// A guy whose desk isn't in yet, and when it comes.
export const WAIT_LINES: readonly string[] = [
  "desk?", "…", "any minute now", "*taps foot*", "I'll stand", "standing desk, I guess", "is it coming?",
  "I can work from the floor", "laptop on knees", "hello? desk?", "first day vibes",
];
export const THANKS_LINES: readonly string[] = ["thanks!", "finally", "nice", "♪", "my desk!", "home sweet desk", "<3", "smells new"];

// A chat line between two guys: quick noises most of the time, then small talk and lines that fit the scene.
export function chatPhrase(scene: OfficeSceneId | undefined, random: Random): string {
  const roll = random();
  if (roll < 0.4) {
    const count = 1 + Math.floor(random() * 3);
    return Array.from({ length: count }, () => pickPhrase(CHATTER_SYMBOLS, random)).join(" ");
  }
  if (scene !== undefined && roll < 0.6) {
    return pickPhrase(SCENE_CHAT[scene], random);
  }
  return pickPhrase(CHAT_LINES, random);
}

// The answer to an exchange's opening line, or undefined for any other line.
const EXCHANGE_ANSWERS = new Map(CHAT_EXCHANGES.map(([line, answer]) => [line, answer]));

export function exchangeAnswer(line: string): string | undefined {
  return EXCHANGE_ANSWERS.get(line);
}

export function pickExchange(random: Random): string {
  return CHAT_EXCHANGES[Math.min(CHAT_EXCHANGES.length - 1, Math.floor(random() * CHAT_EXCHANGES.length))][0];
}
