import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  AGENT_TICKETS_SCHEMA_VERSION,
  declaredTicketsDir,
  declaredTicketsFile,
  DeclaredTicket,
  hasUserTicketMarks,
  isSafeSessionId,
  mergeDeclaredTickets,
  readDeclaredTickets,
  userTicketMarksFile,
  userTicketMarksFromLinkMarks,
} from "./agentTickets";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { LinkMarks } from "./registry";

// fs.watch can miss events on some file systems, so the folder is also polled.
const DECLARED_POLL_INTERVAL_MS = 15_000;
const JSON_FILE_SUFFIX = ".json";

interface CachedDeclaration {
  modifiedAtMs: number;
  tickets: DeclaredTicket[];
}

// Watches the files the overseer CLI writes, and mirrors the user's ticket marks back for `overseer ticket list`.
export class DeclaredTicketMonitor implements vscode.Disposable {
  private readonly declaredDir: string;
  private declarations = new Map<string, CachedDeclaration>();
  private readonly writtenMarksJson = new Map<string, string>();
  private watcher: fs.FSWatcher | undefined;
  private readonly pollTimer: NodeJS.Timeout;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly claudeHome: string, private readonly log: vscode.OutputChannel) {
    this.declaredDir = declaredTicketsDir(claudeHome);
    this.trackLeftoverMarksFiles();
    this.startWatching();
    this.rescan();
    this.pollTimer = setInterval(() => this.rescan(), DECLARED_POLL_INTERVAL_MS);
  }

  declaredTickets(sessionId: string): DeclaredTicket[] {
    return this.declarations.get(sessionId)?.tickets ?? [];
  }

  async copySession(fromSessionId: string, toSessionId: string): Promise<void> {
    const fromTickets = this.declaredTickets(fromSessionId);
    if (fromTickets.length === 0 || !isSafeSessionId(toSessionId)) {
      return;
    }
    const toFile = declaredTicketsFile(this.claudeHome, toSessionId);
    const toTickets = readDeclaredTickets(await loadVersionedCache<unknown>(toFile, AGENT_TICKETS_SCHEMA_VERSION));
    await saveVersionedCache(toFile, mergeDeclaredTickets(toTickets, fromTickets), AGENT_TICKETS_SCHEMA_VERSION);
    this.rescan();
  }

  // Writes only files whose content changed, and deletes the ones for sessions that no longer have ticket marks.
  async syncUserMarks(linkMarksBySession: Record<string, LinkMarks>): Promise<void> {
    const markedSessionIds = new Set<string>();
    for (const [sessionId, linkMarks] of Object.entries(linkMarksBySession)) {
      const userMarks = userTicketMarksFromLinkMarks(linkMarks);
      if (!hasUserTicketMarks(userMarks) || !isSafeSessionId(sessionId)) {
        continue;
      }
      markedSessionIds.add(sessionId);
      const marksJson = JSON.stringify(userMarks);
      if (this.writtenMarksJson.get(sessionId) !== marksJson) {
        await saveVersionedCache(userTicketMarksFile(this.claudeHome, sessionId), userMarks, AGENT_TICKETS_SCHEMA_VERSION);
        this.writtenMarksJson.set(sessionId, marksJson);
      }
    }
    for (const sessionId of [...this.writtenMarksJson.keys()]) {
      if (!markedSessionIds.has(sessionId)) {
        await fs.promises.rm(userTicketMarksFile(this.claudeHome, sessionId), { force: true });
        this.writtenMarksJson.delete(sessionId);
      }
    }
  }

  // Marks files from an earlier run count as written but empty, so the first sync rewrites or deletes them.
  private trackLeftoverMarksFiles(): void {
    try {
      const marksDir = path.dirname(userTicketMarksFile(this.claudeHome, "any"));
      for (const fileName of fs.readdirSync(marksDir)) {
        if (fileName.endsWith(JSON_FILE_SUFFIX)) {
          this.writtenMarksJson.set(fileName.slice(0, -JSON_FILE_SUFFIX.length), "");
        }
      }
    } catch {
      // No marks folder yet.
    }
  }

  private startWatching(): void {
    try {
      fs.mkdirSync(this.declaredDir, { recursive: true });
      this.watcher = fs.watch(this.declaredDir, () => this.rescan());
    } catch (error) {
      this.log.appendLine(`Can't watch ${this.declaredDir}: ${String(error)}`);
    }
  }

  // Only files whose modified time changed are parsed again.
  private rescan(): void {
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(this.declaredDir).filter((fileName) => fileName.endsWith(JSON_FILE_SUFFIX));
    } catch {
      fileNames = [];
    }
    const latestDeclarations = new Map<string, CachedDeclaration>();
    let hasChanged = false;
    for (const fileName of fileNames) {
      const sessionId = fileName.slice(0, -JSON_FILE_SUFFIX.length);
      const declaration = this.readDeclaration(sessionId, path.join(this.declaredDir, fileName));
      if (declaration === undefined) {
        continue;
      }
      if (this.declarations.get(sessionId)?.modifiedAtMs !== declaration.modifiedAtMs) {
        hasChanged = true;
      }
      latestDeclarations.set(sessionId, declaration);
    }
    hasChanged ||= latestDeclarations.size !== this.declarations.size;
    this.declarations = latestDeclarations;
    if (hasChanged) {
      this.changeEmitter.fire();
    }
  }

  private readDeclaration(sessionId: string, declaredFile: string): CachedDeclaration | undefined {
    try {
      const modifiedAtMs = fs.statSync(declaredFile).mtimeMs;
      const cachedDeclaration = this.declarations.get(sessionId);
      if (cachedDeclaration?.modifiedAtMs === modifiedAtMs) {
        return cachedDeclaration;
      }
      const fileContent = JSON.parse(fs.readFileSync(declaredFile, "utf8")) as { version?: unknown; entries?: unknown };
      const tickets = fileContent.version === AGENT_TICKETS_SCHEMA_VERSION ? readDeclaredTickets(fileContent.entries) : [];
      return { modifiedAtMs, tickets };
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.watcher?.close();
    clearInterval(this.pollTimer);
    this.changeEmitter.dispose();
  }
}
