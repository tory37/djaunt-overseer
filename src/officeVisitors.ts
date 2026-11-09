import { Accessory, hashSeed } from "./pixelGuy";

// Pure: people from other departments who drop by the Office now and then, up to five at once. Each walks in and says
// a line or two to the room. Some walk right back out; others hang around a while, chatting, getting coffee, and
// looming over busy guys' desks. Sometimes it's a manager. Each guy has a personality, picked from his seed, that
// decides how he answers: the suck-up says "OK BOSS!", the reasonable ones grumble.

export type Personality = "suckUp" | "grumbler" | "deadpan" | "snark" | "eager";

export interface VisitorKind {
  id: string;
  // Shown when you hover over the visitor.
  title: string;
  boss: boolean;
  shirt: string;
  pants: string;
  // A tie for the bosses, drawn over the shirt.
  tie?: string;
  // Fixed for some departments (IT's glasses); otherwise the visitor's own.
  accessory?: Accessory;
  weight: number;
  openers: readonly string[];
  closers: readonly string[];
  // What he says while hanging around, on top of his openers.
  smallTalk: readonly string[];
}

const BOSS_CLOSERS = [
  "Carry on!", "My door is always open!", "Love it. Carry on.", "Anyway!", "Great chat.", "Keep it up!", "Let's touch base.",
  "Circle back to me.", "Back to my 4 meetings.", "You're all rockstars.", "Ping me!", "Proud of this team.", "Onward!",
  "Let's take it offline.", "I'll let you get back to it.",
];
const DEPT_CLOSERS = [
  "ok bye!", "thx!", "…", "Carry on.", "Just a heads up!", "That's all!", "Bye!", "Cheers!", "Okay, that's it.",
  "See ya!", "Don't tell anyone I was here.", "Back to my desk.", "Later!", "Have a good one!", "Ciao!",
];
const BOSS_TALK = [
  "How's it going?", "What are we working on?", "Is that done yet?", "Walk me through it.", "Love it. Ship it.", "Any blockers?",
  "Let's sync later.", "What's our velocity?", "Is that in the roadmap?", "Can we parallelize that?", "What's the ETA?",
  "Let's get a deck on this.", "Who owns this?", "I read half the doc.", "Can we do it in half the time?", "Big picture?",
  "Are we agile yet?", "Let's double the scope.", "I have a quick ask.", "Just thinking out loud…", "I'm hands-off. Mostly.",
  "Can I get a status?", "Love the hustle.", "Let's not overthink it.", "What would it take?",
];
const DEPT_TALK = [
  "Busy day?", "Did you see the game?", "Weekend plans?", "Is that coffee fresh?", "Nice setup.", "So what do you do here?",
  "Love the plant.", "Is it always this quiet?", "How many monitors is that?", "What's that one do?", "Is that a cat clock?",
  "Cold in here, huh?", "Nice chair.", "What's for lunch?", "Is it Friday yet?", "This place is nicer than ours.",
  "You guys have snacks?", "Do you ever sleep?", "Can I sit here?", "Long week, huh?", "Do you code all day?",
  "I could never.", "My nephew codes.", "Is this the fun floor?", "Who's the dragon guy?",
];

export const VISITOR_KINDS: readonly VisitorKind[] = [
  {
    id: "manager", title: "Manager", boss: true, shirt: "#E8E8E8", pants: "#3A3F58", tie: "#C0392B", accessory: "none", weight: 4,
    openers: [
      "Are you all getting work done in here?", "Keep up the synergy!", "Let's circle back on that.", "Quick sync? No? Great.",
      "Who's on the TPS reports?", "Let's move the needle, people!", "Can we take this offline?", "Remember, we're a family!",
      "Great hustle, team!", "Pizza party Friday. Probably.", "Let's put a pin in it.", "Love the energy in here!",
      "Did everyone get my memo?", "New cover sheets on the TPS reports.", "Who's free for a 7am?", "We need to talk about velocity.",
      "Let's make this a quick meeting.", "Who booked every room?", "Can someone update the Jira?", "Mandatory optional meeting!",
      "Bandwidth check!", "Let's align on alignment.", "I've been told I'm a great listener.", "Reminder: no meeting Wednesdays.",
      "Except this meeting.", "Who has the action items?", "Is this the war room?", "Let's run it up the flagpole.",
      "Let's ideate!", "Low-hanging fruit, people!", "Can I borrow everyone for 5 min?", "Love this. More of this.",
    ],
    closers: BOSS_CLOSERS,
    smallTalk: BOSS_TALK,
  },
  {
    id: "vp", title: "VP of Synergy", boss: true, shirt: "#2B2D42", pants: "#1D1E2C", tie: "#F1C24B", accessory: "none", weight: 1,
    openers: [
      "Let's leverage our core synergies.", "We're pivoting. Again.", "Think outside the box!", "I needed this yesterday.",
      "Can we make it more AI?", "Let's boil the ocean!", "Big things coming, team.", "We're a startup at heart.",
      "Disrupt everything!", "Let's 10x this.", "I just got back from a retreat.", "Blockchain? Still a thing?",
      "Our north star is synergy.", "Paradigm shift incoming!", "I spoke to the board.", "Let's move fast. And break things.",
      "Not those things.", "We're web3. Wait, AI. AI now.", "I want it to feel like magic.", "Q4 is our moment.",
      "I read a book on airplanes.", "Let's be the Uber of something.", "Holistic! Scalable! Agile!",
    ],
    closers: BOSS_CLOSERS,
    smallTalk: BOSS_TALK,
  },
  {
    id: "ceo", title: "CEO", boss: true, shirt: "#111318", pants: "#111318", tie: "#7E57C2", accessory: "none", weight: 0.4,
    openers: [
      "Hi everyone! Don't mind me.", "Just walking the floor.", "I'm one of you, really.", "Who's the best coder here?",
      "Love what you're doing. What is it?", "I just landed from Davos.", "We're crushing it.", "Remember the mission!",
      "What's the mission again?", "I bought a boat.", "Lean in!", "Is this the dragon team?", "All hands at 4!",
      "I remember my first line of code.", "Stock's up! Probably.",
    ],
    closers: ["Keep crushing it!", "You're the heart of this company.", "My jet's waiting.", "Love you all. Professionally.", "Onward!"],
    smallTalk: BOSS_TALK,
  },
  {
    id: "hr", title: "HR", boss: false, shirt: "#E07A9B", pants: "#5B4B5E", weight: 1,
    openers: [
      "Mandatory fun at 3pm!", "Who has the birthday card?", "Please finish your trainings.", "Who microwaved fish?",
      "Benefits close today!", "Team building on Friday!", "Trust falls at noon!", "Please update your emergency contact.",
      "Who keeps saying 'ninja' in job posts?", "Wellness week starts Monday!", "Hydrate! It's in the handbook.",
      "Sign the card for Dave!", "Who's Dave? Sign it anyway.", "Ugly sweater day is coming.", "We have a new mood board.",
      "Please stop calling it 'the dungeon'.", "Who brought the goat?", "Use your PTO!", "Not all at once!",
      "Reminder: we're a family. A legal one.", "Survey closes in an hour!",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "How's your work-life balance?", "Feeling engaged?", "On a scale of 1 to 10?", "Have you done the survey?"],
  },
  {
    id: "it", title: "IT", boss: false, shirt: "#4A7C59", pants: "#2F3A33", accessory: "glasses", weight: 1,
    openers: [
      "Have you tried turning it off and on?", "Who clicked the phishing link?", "Rebooting everything. Don't panic.",
      "Passwords need 40 chars now.", "Is this plugged in?", "Your password expires in 5 min.", "Who installed a crypto miner?",
      "Updates tonight. All of them.", "The VPN is down. Again.", "Who has my ethernet cable?", "Did someone print 900 pages?",
      "Don't download the internet.", "Which one of you is 'admin'?", "New laptops! Next year.", "Mandatory 2FA. And 3FA.",
      "Please stop naming your PC 'skynet'.", "Who's streaming 4K cats?", "Clear your cookies. Not those cookies.",
      "Ticket #4000 is open.", "It's not my fault. It's DNS.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Did you reboot?", "Is that Windows Vista?", "Your fan sounds sick.", "Lock your screen!"],
  },
  {
    id: "sales", title: "Sales", boss: false, shirt: "#F4A259", pants: "#3D3B4F", weight: 1,
    openers: [
      "Can it do this by Friday?", "I already sold that feature.", "The client wants it to pop.", "Can we add AI to it?",
      "Need a demo in 5 min!", "I promised it'd be free.", "The client called it 'buggy'.", "Can it run on a fax machine?",
      "Big deal closing! Can it do X?", "What's X? No idea.", "I told them 99.999% uptime.", "Can we white-label it by noon?",
      "The client wants it blue. No, green.", "I sold the roadmap.", "Who wants to come golfing?", "Commission check incoming!",
      "It's basically done, right?", "The demo crashed. Twice.", "They want it on-prem. On a boat.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Can you hop on a call?", "It's a quick call!", "Just smile and nod.", "Love the vibe here."],
  },
  {
    id: "marketing", title: "Marketing", boss: false, shirt: "#B56CE0", pants: "#33264A", weight: 1,
    openers: [
      "Can the logo be bigger?", "We need it to go viral.", "Let's rebrand!", "More gradients!", "Is this on brand?",
      "Can we make it pop?", "Smaller. No, bigger.", "We're doing a TikTok.", "Who wants to be in the video?",
      "We need a mascot.", "The dragon is the mascot now.", "Can it be more… purple?", "Synergy, but make it fun.",
      "Engagement is up 2%!", "We renamed the product.", "Comic Sans? Hear me out.", "Let's A/B test the office.",
      "Rounder corners!", "Dark mode is a brand.", "Let's put it on a billboard.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Is that font on brand?", "Can I take a photo?", "Smile for the socials!", "This is content."],
  },
  {
    id: "facilities", title: "Facilities", boss: false, shirt: "#E8C547", pants: "#3B4A5A", accessory: "cap", weight: 1,
    openers: [
      "Fire drill at 2!", "Don't touch the thermostat.", "Who unplugged the fridge?", "Wet floor. Probably.",
      "The fridge gets cleaned Friday.", "Everything goes. Everything.", "Who's been feeding the pigeons?",
      "Elevator's out. Stairs it is.", "There's a raccoon in the vents.", "Who glued the stapler down?", "Water main's fine. Mostly.",
      "New chairs. Same chairs.", "Who left a fish in the drawer?", "Don't lean on that wall.", "Light bulbs! Who needs 'em?",
      "Is there a dragon in the cave?", "Moving desks Tuesday.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Who stole the mop?", "That chair squeaks.", "Don't put your feet on that."],
  },
  {
    id: "accounting", title: "Accounting", boss: false, shirt: "#8D99AE", pants: "#2B2D42", accessory: "glasses", weight: 1,
    openers: [
      "Who expensed a dragon?", "Receipts, people!", "Budget's frozen. Again.", "Was that a business lunch?",
      "Who expensed 400 rubber ducks?", "The cloud bill is… large.", "Who's running 900 GPUs?", "Please, no more standing desks.",
      "Q3 numbers are… numbers.", "That's not deductible.", "Spreadsheets don't lie.", "Who bought a yacht on the corp card?",
      "Why is there a line item for 'vibes'?", "Pennies add up!", "The audit is Thursday.", "Shred nothing.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Is that a company laptop?", "Who paid for that?", "Lovely. How much?"],
  },
  {
    id: "intern", title: "Intern", boss: false, shirt: "#6FB3E0", pants: "#44546A", weight: 1,
    openers: [
      "Where's the printer?", "Is this the meeting?", "Coffee run, anyone?", "What does a PR do?", "Am I paid for this?",
      "I pushed to main. Is that bad?", "What's a merge conflict?", "I deleted a branch. Which one? Good question.",
      "Is there free food?", "How do I exit Vim?", "My manager is on vacation.", "Who's my manager?",
      "I made a startup this weekend.", "What's Jira?", "Is this my desk?", "I fixed a typo!", "Can I have admin?",
      "The coffee machine hates me.", "First day! Or third?",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Is it okay to leave at 5?", "What does this button do?", "Can I watch you code?", "Wow."],
  },
  {
    id: "legal", title: "Legal", boss: false, shirt: "#5C4B51", pants: "#2A2326", weight: 1,
    openers: [
      "Don't put that in writing.", "Stop naming servers after exes.", "Allegedly.", "Did anyone sign this?",
      "Who agreed to the terms?", "Nobody reads the terms.", "Is that GPL?", "Please stop copy-pasting from the internet.",
      "Who trademarked 'dragon'?", "No comment.", "We need to talk. Not here.", "That joke is a liability.",
      "Delete that Slack message.", "Nothing is 'unlimited'.", "Hypothetically speaking…", "Who licensed the cat clock?",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Did you read the NDA?", "I can't say.", "Off the record?", "Allegedly."],
  },
  {
    id: "qa", title: "QA", boss: false, shirt: "#D45D5D", pants: "#3A2E2E", accessory: "glasses", weight: 1,
    openers: [
      "Found a bug.", "Found 40 bugs.", "Is this supposed to do that?", "I clicked it 900 times.", "It broke on Tuesdays.",
      "Only on Tuesdays.", "What if the user types an emoji?", "I entered -1 items.", "I ordered a lizard. It worked?",
      "Works in Chrome. Not my fridge.", "Can't reproduce. I'll try harder.", "I filed a ticket. Then 30 more.",
      "Who wrote this test?", "The test passes. Suspicious.", "Edge case: what if it's Mars?",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Can you break it for me?", "What if I click here?", "Ooh, a bug.", "Reproducible?"],
  },
  {
    id: "security", title: "Security", boss: false, shirt: "#2F2F2F", pants: "#1A1A1A", accessory: "headphones", weight: 1,
    openers: [
      "Lock your screens!", "Who left a USB in the lot?", "Did you plug it in? Why?!", "Password on a sticky note. Again.",
      "Badge in, everyone.", "Tailgating is a crime.", "We're running a phishing test.", "You failed the phishing test.",
      "Who hardcoded the API key?", "Rotate your keys!", "The firewall is my love language.", "Trust no one.",
      "Except me. Trust me.", "Who's 'hunter2'?", "Zero trust, people!",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Is that screen locked?", "Who's that?", "I'm watching.", "Badge?"],
  },
  {
    id: "design", title: "Design", boss: false, shirt: "#F2E8CF", pants: "#6A994E", weight: 1,
    openers: [
      "Can we move it 1 pixel left?", "No, the other left.", "Which font is that?!", "Kerning, people!",
      "It needs more whitespace.", "It needs less whitespace.", "Is that the right gray?", "There are 50 grays.",
      "Who used the default blue?", "Feels a little off.", "What's the user journey?", "Let's do a mood board.",
      "It's not centered. I can feel it.", "Make it feel friendlier.", "Rounder!",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "Love the palette.", "That's a nice icon.", "Is it accessible?", "Hmm. Spacing."],
  },
  {
    id: "product", title: "Product", boss: false, shirt: "#3D84A8", pants: "#2E4057", weight: 1,
    openers: [
      "Small change. Tiny.", "The spec changed.", "The spec changed back.", "Users want it. Probably.",
      "I did a survey of 3 people.", "Can we add a toggle?", "Can we remove the toggle?", "It's an MVP.",
      "MVP means 'most features'.", "Let's ship and learn!", "What's the north star metric?", "I wrote a PRD.",
      "Who read the PRD?", "Is it in this sprint?", "Scope creep? Never heard of it.",
    ],
    closers: DEPT_CLOSERS,
    smallTalk: [...DEPT_TALK, "What's the user story?", "Is that in scope?", "Let's prioritize.", "Quick question…"],
  },
];

// How each personality answers a boss, and anyone else.
export const REACTIONS: Record<Personality, { boss: readonly string[]; other: readonly string[] }> = {
  suckUp: {
    boss: [
      "OK BOSS!", "You got it, boss!", "Love that, boss!", "Synergy!!", "Yes sir!", "Great idea, boss!", "Brilliant!",
      "Nice tie, boss!", "Visionary!", "Already on it, boss!", "Best boss ever!", "Taking notes!", "I'll stay late!",
      "Inspiring!", "So true, boss!", "Can I get you a coffee?",
    ],
    other: ["Great point!", "Totally!", "So true!", "Love it!", "Amazing!", "Wow, yes!", "Great question!", "Agreed!"],
  },
  grumbler: {
    boss: [
      "*grumble*", "*grumble grumble*", "*sigh*", "mhm.", "sure.", "here we go…", "another meeting.", "fantastic.",
      "*mutters*", "can't wait.", "of course.", "*heavy sigh*", "yep.", "I'm busy.",
    ],
    other: ["*grumble*", "*sigh*", "not now…", "ugh.", "busy.", "meh.", "go away.", "*mutters*", "why."],
  },
  deadpan: {
    boss: ["Wow ok.", "cool.", "noted.", "k.", "riveting.", "great.", "sure.", "fascinating.", "thrilling.", "ok.", "neat."],
    other: ["Wow ok.", "cool.", "neat.", "k.", "nice.", "hm.", "interesting.", "huh.", "sure."],
  },
  snark: {
    boss: [
      "lol", "uh huh.", "*eye roll*", "sure thing.", "classic.", "bold.", "ok, Steve Jobs.", "big if true.",
      "add it to the pile.", "sounds expensive.", "in this economy?", "sure, I'll pivot.", "lmao ok",
    ],
    other: ["lol no.", "sure, buddy.", "*eye roll*", "lmao", "cool story.", "ok and?", "fascinating. not.", "rip.", "bold move."],
  },
  eager: {
    boss: ["On it!", "!", "can do!", "aye aye!", "yes yes yes!", "I'll do it!", "pick me!", "ooh, me!", "let's go!", "right away!"],
    other: ["ooh!", "me!", "!", "yes!", "fun!", "count me in!", "really?!", "wow!", "tell me more!"],
  },
};

const ASLEEP_MUMBLES = ["zzz…", "zzz", "mm…five more…", "*snore*", "not now…", "zz… ship it… zz", "*mumbles*"];

// Most of the room is reasonable; a couple are suck-ups.
const PERSONALITIES: readonly [Personality, number][] = [["suckUp", 2], ["grumbler", 4], ["deadpan", 3], ["snark", 2], ["eager", 1]];

export function personalityOf(seed: string): Personality {
  const total = PERSONALITIES.reduce((sum, [, weight]) => sum + weight, 0);
  // A different stream of the hash than the look uses, so personality doesn't follow hair color.
  let roll = hashSeed(`${seed}|personality`) % total;
  for (const [personality, weight] of PERSONALITIES) {
    roll -= weight;
    if (roll < 0) {
      return personality;
    }
  }
  return "grumbler";
}

export interface VisitPlan {
  kind: VisitorKind;
  // Said to the room on arrival.
  lines: string[];
  // Seconds he hangs around after his lines; 0 walks right back out.
  stay: number;
  // Said on the way out after hanging around.
  farewell: string | undefined;
}

// At most this many visitors in the room at once.
export const MAX_VISITORS = 5;

export function planVisit(random: () => number): VisitPlan {
  const total = VISITOR_KINDS.reduce((sum, kind) => sum + kind.weight, 0);
  let roll = random() * total;
  let kind = VISITOR_KINDS[VISITOR_KINDS.length - 1];
  for (const candidate of VISITOR_KINDS) {
    roll -= candidate.weight;
    if (roll < 0) {
      kind = candidate;
      break;
    }
  }
  const lines = [pick(kind.openers, random)];
  const stay = visitorStay(random);
  const closer = random() < 0.7 ? pick(kind.closers, random) : undefined;
  if (stay === 0 && closer !== undefined) {
    lines.push(closer);
  }
  return { kind, lines, stay, farewell: stay === 0 ? undefined : closer };
}

// How long a visitor hangs around: a few say their piece and go, most stay a minute or two, some settle in.
export function visitorStay(random: () => number): number {
  const roll = random();
  if (roll < 0.35) {
    return 0;
  }
  if (roll < 0.75) {
    return 45 + random() * 105;
  }
  return 180 + random() * 420;
}

// What a visitor says while hanging around.
export function visitorSmallTalk(kind: VisitorKind): string[] {
  return [...kind.openers, ...kind.smallTalk];
}

// What a guy says back, or undefined when he lets it go. A suck-up never lets a boss go; asleep guys mumble.
export function visitorReaction(personality: Personality, boss: boolean, asleep: boolean, random: () => number): string | undefined {
  if (asleep) {
    return random() < 0.4 ? pick(ASLEEP_MUMBLES, random) : undefined;
  }
  if (!(personality === "suckUp" && boss) && random() >= 0.65) {
    return undefined;
  }
  return pick(REACTIONS[personality][boss ? "boss" : "other"], random);
}

// How often visitors come (overseer.office.visitors), as seconds between arrivals.
export type VisitorFrequency = "off" | "rare" | "normal" | "often" | "packed";

export const VISITOR_FREQUENCIES: Record<Exclude<VisitorFrequency, "off">, readonly [number, number]> = {
  rare: [180, 360],
  normal: [60, 150],
  often: [25, 75],
  packed: [8, 30],
};

export function visitorFrequency(value: unknown): VisitorFrequency {
  if (value === false) {
    return "off";
  }
  return value === "off" || (typeof value === "string" && value in VISITOR_FREQUENCIES) ? (value as VisitorFrequency) : "normal";
}

// Seconds until the next visitor arrives; the first comes sooner.
export function visitorGap(random: () => number, frequency: Exclude<VisitorFrequency, "off"> = "normal", first = false): number {
  const [low, high] = VISITOR_FREQUENCIES[frequency];
  return first ? low * 0.4 + random() * low * 0.6 : low + random() * (high - low);
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}
