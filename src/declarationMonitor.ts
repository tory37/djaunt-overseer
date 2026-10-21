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
import {
  AGENT_WORK_SCHEMA_VERSION,
  declaredWorkDir,
  declaredWorkFile,
  EMPTY_SESSION_WORK,
  hasSessionWork,
  mergeSessionWork,
  readSessionWork,
  SessionWork,
} from "./agentWork";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { LinkMarks } from "./registry";

// fs.watch can miss events on some file systems, so the folders are also polled.
const DECLARED_POLL_INTERVAL_MS = 15_000;
const JSON_FILE_SUFFIX = ".json";

interface CachedFile<Value> {
  modifiedAtMs: number;
  value: Value;
}

// One file per session; only files whose modified time changed are parsed again.
class SessionFileFolder<Value> {
  private files = new Map<string, CachedFile<Value>>();

  constructor(
    readonly dir: string,
    private readonly schemaVersion: number,
    private readonly readEntries: (entries: unknown) => Value,
  ) {}

  get(sessionId: string): Value | undefined {
    return this.files.get(sessionId)?.value;
  }

  // Returns whether anything changed.
  rescan(): boolean {
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(this.dir).filter((fileName) => fileName.endsWith(JSON_FILE_SUFFIX));
    } catch {
      fileNames = [];
    }
    const latestFiles = new Map<string, CachedFile<Value>>();
    let hasChanged = false;
    for (const fileName of fileNames) {
      const sessionId = fileName.slice(0, -JSON_FILE_SUFFIX.length);
      const cachedFile = this.read(sessionId, path.join(this.dir, fileName));
      if (cachedFile === undefined) {
        continue;
      }
      hasChanged ||= this.files.get(sessionId)?.modifiedAtMs !== cachedFile.modifiedAtMs;
      latestFiles.set(sessionId, cachedFile);
    }
    hasChanged ||= latestFiles.size !== this.files.size;
    this.files = latestFiles;
    return hasChanged;
  }

  private read(sessionId: string, filePath: string): CachedFile<Value> | undefined {
    try {
      const modifiedAtMs = fs.statSync(filePath).mtimeMs;
      const cachedFile = this.files.get(sessionId);
      if (cachedFile?.modifiedAtMs === modifiedAtMs) {
        return cachedFile;
      }
      const fileContent = JSON.parse(fs.readFileSync(filePath, "utf8")) as { version?: unknown; entries?: unknown };
      const entries = fileContent.version === this.schemaVersion ? fileContent.entries : undefined;
      return { modifiedAtMs, value: this.readEntries(entries) };
    } catch {
      return undefined;
    }
  }
}

// Watches the files the overseer CLI writes, and mirrors the user's ticket marks back for `overseer ticket list`.
export class DeclarationMonitor implements vscode.Disposable {
  private readonly ticketFolder: SessionFileFolder<DeclaredTicket[]>;
  private readonly workFolder: SessionFileFolder<SessionWork>;
  private readonly writtenMarksJson = new Map<string, string>();
  private readonly watchers: fs.FSWatcher[] = [];
  private readonly pollTimer: NodeJS.Timeout;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly claudeHome: string, private readonly log: vscode.OutputChannel) {
    this.ticketFolder = new SessionFileFolder(declaredTicketsDir(claudeHome), AGENT_TICKETS_SCHEMA_VERSION, readDeclaredTickets);
    this.workFolder = new SessionFileFolder(declaredWorkDir(claudeHome), AGENT_WORK_SCHEMA_VERSION, readSessionWork);
    this.trackLeftoverMarksFiles();
    this.watch(this.ticketFolder.dir);
    this.watch(this.workFolder.dir);
    this.rescan();
    this.pollTimer = setInterval(() => this.rescan(), DECLARED_POLL_INTERVAL_MS);
  }

  declaredTickets(sessionId: string): DeclaredTicket[] {
    return this.ticketFolder.get(sessionId) ?? [];
  }

  sessionWork(sessionId: string): SessionWork {
    return this.workFolder.get(sessionId) ?? EMPTY_SESSION_WORK;
  }

  async copySession(fromSessionId: string, toSessionId: string): Promise<void> {
    if (!isSafeSessionId(toSessionId)) {
      return;
    }
    const fromTickets = this.declaredTickets(fromSessionId);
    if (fromTickets.length > 0) {
      const toFile = declaredTicketsFile(this.claudeHome, toSessionId);
      const toTickets = readDeclaredTickets(await loadVersionedCache<unknown>(toFile, AGENT_TICKETS_SCHEMA_VERSION));
      await saveVersionedCache(toFile, mergeDeclaredTickets(toTickets, fromTickets), AGENT_TICKETS_SCHEMA_VERSION);
    }
    const fromWork = this.sessionWork(fromSessionId);
    if (hasSessionWork(fromWork)) {
      const toFile = declaredWorkFile(this.claudeHome, toSessionId);
      const toWork = readSessionWork(await loadVersionedCache<unknown>(toFile, AGENT_WORK_SCHEMA_VERSION));
      await saveVersionedCache(toFile, mergeSessionWork(toWork, fromWork), AGENT_WORK_SCHEMA_VERSION);
    }
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

  rescan(): void {
    const ticketsChanged = this.ticketFolder.rescan();
    const workChanged = this.workFolder.rescan();
    if (ticketsChanged || workChanged) {
      this.changeEmitter.fire();
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

  private watch(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.watchers.push(fs.watch(dir, () => this.rescan()));
    } catch (error) {
      this.log.appendLine(`Can't watch ${dir}: ${String(error)}`);
    }
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    clearInterval(this.pollTimer);
    this.changeEmitter.dispose();
  }
}
