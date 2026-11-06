// A scene fragment for the Djaunt view: one line of fake hacker status in a strip along the bottom. It decrypts in,
// idles with animated dots, and scrambles out. During ERROR, HACK, and DEFENSE it shows that event's lines.
// The host scene calls drawTicker(seconds, event, top, stripHeight) last, so the strip stays on top.
const TICKER_PHRASES = [
  "working on the mainframe...",
  "looking for vulnerabilities...",
  "reticulating splines...",
  "enhancing... enhance...",
  "downloading more RAM...",
  "bypassing the gibson...",
  "compiling the kernel...",
  "hacking the planet...",
  "rerouting the subnet...",
  "decrypting the cyber...",
  "pinging localhost...",
  "triangulating the IP...",
  "reversing the polarity...",
  "spoofing the MAC address...",
  "brute forcing the password...",
  "trying password123...",
  "trying hunter2...",
  "defragmenting the cloud...",
  "warming up the GPUs...",
  "mining nothing in particular...",
  "overclocking the toaster...",
  "sudo make me a sandwich...",
  "rm -rf the evidence...",
  "inverting the binary tree...",
  "resolving merge conflicts...",
  "blaming the intern...",
  "consulting stack overflow...",
  "turning it off and on...",
  "clearing the cache...",
  "dividing by zero...",
  "untangling the spaghetti...",
  "patching the matrix...",
  "routing through 7 proxies...",
  "tracing the packets...",
  "injecting the SQL...",
  "escaping the strings...",
  "flipping the bits...",
  "allocating the heap...",
  "collecting the garbage...",
  "parsing HTML with regex...",
  "centering the div...",
  "spinning up containers...",
  "scaling to zero...",
  "pushing to prod on friday...",
  "summoning the daemons...",
  "forking the process...",
  "joining the threads...",
  "negotiating the handshake...",
  "rotating the keys...",
  "salting the hashes...",
  "calibrating the flux...",
  "uploading the virus...",
  "hacking the firewall...",
  "zooming and enhancing...",
  "accessing the main grid...",
  "tuning the neural net...",
  "buffering the overflow...",
  "dialing into the BBS...",
  "feeding the hamsters...",
  "aligning the satellites...",
  "counting to infinity...",
  "asking the AI nicely...",
];

export const HACKER_TICKER_SCRIPT = `
  const PHRASES = ${JSON.stringify(TICKER_PHRASES)};
  const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const SCRAMBLE = "0123456789ABCDEF#$%&*+<>/=?ｱｳｶｻﾀﾅﾊﾏﾔﾗ";
  const DECRYPT_SECONDS = 0.6;
  const EXIT_SECONDS = 0.3;
  // Event lines by start second. Hack and defense lines come from the event so the ticker agrees with the big text.
  const ERROR_LINES = [[0, "FATAL EXCEPTION 0xDEAD"], [1.2, "core dumped"], [2.5, "rebooting..."]];
  const HACK_LINES = [[0, "injecting payload..."], [1.3, "bypassing firewall..."]];
  const HACK_REVEAL_AT = 2.6;
  const DEFENSE_AT = [0, 1.8, 3.8, 5.4];

  let bag = [];
  let lastPhrase = null;
  let line = null;

  // Shuffled bag: every phrase plays once per round, and never twice in a row across rounds.
  function nextPhrase() {
    if (bag.length === 0) {
      bag = PHRASES.slice();
      for (let index = bag.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [bag[index], bag[swap]] = [bag[swap], bag[index]];
      }
      if (bag[bag.length - 1] === lastPhrase) bag.unshift(bag.pop());
    }
    lastPhrase = bag.pop();
    return lastPhrase;
  }

  function eventLine(event) {
    if (event.kind === "error") return ERROR_LINES.filter(([at]) => event.age >= at).pop();
    if (event.kind === "hack") {
      return event.age >= HACK_REVEAL_AT ? [HACK_REVEAL_AT, event.phrases[0].toLowerCase() + "."] : HACK_LINES.filter(([at]) => event.age >= at).pop();
    }
    const beat = DEFENSE_AT.filter((at) => event.age >= at).length - 1;
    return [DEFENSE_AT[beat], event.lines[beat].toLowerCase() + (beat < 3 && !event.lines[beat].endsWith("!") ? "..." : beat < 3 ? "" : ".")];
  }

  // A phrase ending in "..." gets its dots animated instead of printed.
  function startLine(text, seconds, duration) {
    const dotted = text.endsWith("...");
    line = { text: dotted ? text.slice(0, -3) : text, dotted, start: seconds, duration };
  }

  const background = () => getComputedStyle(document.documentElement).getPropertyValue("--vscode-sideBar-background").trim() || "#000";
  const scrambled = (seed) => SCRAMBLE[Math.abs(Math.floor(Math.sin(seed) * 10000)) % SCRAMBLE.length];

  function drawTicker(seconds, event, top, stripHeight) {
    if (event !== null) {
      const [at, text] = eventLine(event);
      const start = event.start + at;
      if (line === null || line.eventStart !== start) {
        startLine(text, start, Infinity);
        line.eventStart = start;
      }
    } else if (line === null || line.eventStart !== undefined || seconds - line.start >= line.duration) {
      startLine(nextPhrase(), seconds, 2.5 + Math.random() * 1.5);
    }

    const age = seconds - line.start;
    const leaving = line.duration - age;
    const fontSize = Math.max(10, Math.min(12, stripHeight * 0.5));
    context.font = fontSize + "px " + fontFamily;
    context.textBaseline = "middle";
    context.textAlign = "left";
    const ink = event === null ? palette.primary : eventColor(palette, event);
    const centerY = top + stripHeight / 2;
    const charWidth = context.measureText("M").width;
    const tick = Math.floor(seconds * 20);
    const textX = 8 + charWidth * 3.2;

    // A backing plate keeps the line readable over the matrix rain and anything that flies low, and a faint rule
    // separates the strip from the scene.
    context.fillStyle = background();
    context.globalAlpha = 0.85;
    context.fillRect(0, top, width, stripHeight);
    context.fillStyle = palette.dim;
    context.globalAlpha = 0.25;
    context.fillRect(0, top, width, 1);
    context.globalAlpha = 1;

    context.fillStyle = palette.accent;
    context.fillText(SPINNER[Math.floor(seconds * 12) % SPINNER.length], 8, centerY);
    context.fillStyle = palette.dim;
    context.fillText(">", 8 + charWidth * 1.6, centerY);

    // Fit the line: drop characters off the end and add an ellipsis when the panel is narrow.
    const room = Math.max(0, Math.floor((width - textX - 8) / charWidth) - 4);
    let text = line.text;
    if (text.length > room) text = text.slice(0, Math.max(0, room - 1)) + "…";

    // Decrypt sweeps left to right with a few scrambled glyphs ahead of it. The exit scrambles from the right.
    const revealed = clamp01(age / DECRYPT_SECONDS) * (text.length + 4);
    const exiting = leaving < EXIT_SECONDS ? clamp01(1 - leaving / EXIT_SECONDS) : 0;
    let shown = "";
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      const fromEnd = (text.length - index) / text.length;
      if (character === " ") shown += " ";
      else if (exiting > 0 && fromEnd < exiting) shown += Math.random() < exiting * 0.6 ? " " : scrambled(index * 31 + tick);
      else if (index < revealed - 4) shown += character;
      else if (index < revealed) shown += scrambled(index * 17 + tick);
      else shown += " ";
    }
    const settled = revealed >= text.length + 4 && exiting === 0;
    const dots = line.dotted && settled ? ".".repeat(Math.floor(age * 3) % 4) : "";
    const shaking = event !== null && event.kind === "error" && event.age < 2.5;
    const glitch = shaking || exiting > 0 || Math.sin(tick * 12.9898) > 0.995 ? (Math.random() - 0.5) * 3 : 0;

    context.fillStyle = ink;
    context.globalAlpha = 1 - exiting * 0.5;
    context.fillText(shown + dots, textX + glitch, centerY);
    context.globalAlpha = 1;

    const cursorIndex = settled ? text.length + dots.length : Math.min(text.length, Math.floor(revealed));
    if (Math.floor(seconds * 2.5) % 2 === 0 || !settled) {
      context.fillStyle = ink;
      context.globalAlpha = 0.85;
      context.fillRect(textX + cursorIndex * charWidth + 2, centerY - fontSize * 0.5, charWidth * 0.75, fontSize);
      context.globalAlpha = 1;
    }

    // A hairline under the text fills over the phrase's life, with a bright head.
    const progress = line.duration === Infinity ? (Math.sin(seconds * 3) * 0.5 + 0.5) : clamp01(age / line.duration);
    context.fillStyle = palette.dim;
    context.globalAlpha = 0.18;
    context.fillRect(0, top + stripHeight - 1, width, 1);
    context.fillStyle = ink;
    context.globalAlpha = 0.55;
    context.fillRect(0, top + stripHeight - 1, width * progress, 1);
    context.globalAlpha = 1;
    context.fillRect(width * progress - 6, top + stripHeight - 1, 6, 1);
  }
`;
