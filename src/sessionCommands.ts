export interface SessionCommand {
  name: string;
  prompt: string;
}

export const DEFAULT_SESSION_COMMANDS: SessionCommand[] = [
  { name: "Check PR Reviews", prompt: "Latest reviews are in on the PR. Pull them and evaluate." },
  { name: "Monitor AI Code Reviews", prompt: "Start monitoring for new AI code reviews, address them as they land." },
  { name: "Triage", prompt: "Start triage for: {ticket link}" },
];

const PARAMETER_PATTERN = /\{([^{}]+)\}/g;

// A setting edited by hand can hold anything; bad entries drop out so the picker never breaks.
export function parseSessionCommands(configured: unknown): SessionCommand[] {
  if (!Array.isArray(configured)) {
    return DEFAULT_SESSION_COMMANDS;
  }
  const commands: SessionCommand[] = [];
  for (const entry of configured) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const fields = entry as Record<string, unknown>;
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    const prompt = typeof fields.prompt === "string" ? fields.prompt.trim() : "";
    if (name !== "" && prompt !== "") {
      commands.push({ name, prompt });
    }
  }
  return commands;
}

// Each {placeholder} in a prompt is a parameter the user fills in; a repeated one is asked once.
export function promptParameters(prompt: string): string[] {
  const parameterNames = [...prompt.matchAll(PARAMETER_PATTERN)].map((match) => match[1].trim());
  return [...new Set(parameterNames)];
}

// Values lose their line breaks, because Enter inside a Claude input sends the prompt early.
export function fillPrompt(prompt: string, valuesByParameter: Record<string, string>): string {
  return prompt.replace(PARAMETER_PATTERN, (_placeholder, parameterName: string) =>
    (valuesByParameter[parameterName.trim()] ?? "").replace(/[\r\n]+/g, " ").trim(),
  );
}
