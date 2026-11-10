// Pure: the Office's workers from the sidebar's pinned sessions. One guy per Claude session (plain terminal rows get
// none): busy or idle while live, asleep when suspended (or left out, with the sleepers setting off). The focused
// session's guy wears the crown, and a look made in the character maker replaces his seed's look.

import type { PinnedSession } from "./grouping";
import type { OfficeAgent } from "./officeSimulationApi";

export interface OfficeAgentSources {
  pinned: readonly PinnedSession[];
  liveStatus: (sessionId: string) => "busy" | "idle" | undefined;
  showSleepers: boolean;
  seed: (sessionId: string) => string;
  look: (sessionId: string) => unknown;
  title: (sessionId: string) => string;
  focusedId: string | undefined;
}

export function officeAgents(sources: OfficeAgentSources): OfficeAgent[] {
  const agents: OfficeAgent[] = [];
  const seen = new Set<string>();
  for (const pinned of sources.pinned) {
    const id = pinned.sessionId;
    if (pinned.terminal !== undefined || seen.has(id)) {
      continue;
    }
    const live = sources.liveStatus(id);
    if (live === undefined && !sources.showSleepers) {
      continue;
    }
    seen.add(id);
    const look = sources.look(id);
    agents.push({
      id,
      seed: sources.seed(id),
      status: live ?? "asleep",
      title: sources.title(id),
      ...(look !== null && typeof look === "object" ? { look: look as OfficeAgent["look"] } : {}),
      ...(id === sources.focusedId ? { highlighted: true } : {}),
    });
  }
  return agents;
}
