// Prefixes that look like ticket keys in prose but never are.
const NON_TICKET_PREFIXES = new Set(["UTF", "ISO", "SHA", "RFC", "PEP", "PR", "HTTP", "TLS", "MD", "ES", "CVE", "WCAG", "MAIN", "MASTER", "DEVELOP", "RELEASE"]);

const TITLE_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+)[- ](\d+)\b/g;
const BRANCH_TICKET_PATTERN = /(?:^|\/)([a-z][a-z0-9]+)-(\d+)/gi;

export interface TicketSources {
  title?: string;
  gitBranch?: string;
  firstPrompt?: string;
}

export function extractTicketKey(sources: TicketSources): string | undefined {
  return (
    findTicketKey(sources.title, TITLE_TICKET_PATTERN) ??
    findTicketKey(sources.gitBranch, BRANCH_TICKET_PATTERN) ??
    findTicketKey(sources.firstPrompt, TITLE_TICKET_PATTERN)
  );
}

// Prose needs the hyphen; "OPS 2829" style keys are only trusted in titles.
const PROSE_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;

export function findTicketKeysInText(text: string): string[] {
  const ticketKeys = new Set<string>();
  for (const match of text.matchAll(PROSE_TICKET_PATTERN)) {
    if (!NON_TICKET_PREFIXES.has(match[1])) {
      ticketKeys.add(`${match[1]}-${match[2]}`);
    }
  }
  return [...ticketKeys];
}

export function isTicketKey(candidateKey: string): boolean {
  const match = /^([A-Z][A-Z0-9]+)-\d+$/.exec(candidateKey);
  return match !== null && !NON_TICKET_PREFIXES.has(match[1]);
}

function findTicketKey(text: string | undefined, pattern: RegExp): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  for (const match of text.matchAll(pattern)) {
    const projectPrefix = match[1].toUpperCase();
    if (!NON_TICKET_PREFIXES.has(projectPrefix)) {
      return `${projectPrefix}-${match[2]}`;
    }
  }
  return undefined;
}
