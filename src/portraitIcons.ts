import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { OfficeLook, OfficeSimulationApi } from "./officeSimulationApi";
import { badgeColor, badgeStyle } from "./portraitBadge";
import { SessionIconState } from "./sessionIcons";

const PORTRAITS_SETTING = "overseer.office.portraits";
// The Office's setting: with races off, everyone's human.
const RACES_SETTING = "officeSim.races";

// Where the portraits come from: the Office's API while it's hooked in.
export interface PortraitSource {
  readonly api: OfficeSimulationApi | undefined;
  readonly onDidChangeConnection: vscode.Event<void>;
}

interface ContributedTheme {
  label?: unknown;
  path?: unknown;
}

// The session rows' pixel-guy portraits, as data URIs, cached by seed, look, and state, drawn by the Office Simulation
// extension. Without it the rows keep their codicons. The badge colors are read once per theme or color customization
// change.
export class PortraitIcons implements vscode.Disposable {
  private readonly icons = new Map<string, vscode.Uri>();
  private readonly themeColorsByName = new Map<string, Record<string, unknown> | undefined>();
  private readonly configListener: vscode.Disposable;
  private readonly themeListener: vscode.Disposable;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly officeListener: vscode.Disposable;

  constructor(private readonly extension: vscode.Extension<unknown>, private readonly office: PortraitSource) {
    this.officeListener = office.onDidChangeConnection(() => {
      this.icons.clear();
      this.changeEmitter.fire();
    });
    this.configListener = vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration("workbench.colorCustomizations") || change.affectsConfiguration("workbench.colorTheme") ||
        change.affectsConfiguration(PORTRAITS_SETTING) || change.affectsConfiguration(RACES_SETTING)) {
        this.icons.clear();
        this.changeEmitter.fire();
      }
    });
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      this.icons.clear();
      this.changeEmitter.fire();
    });
  }

  isEnabled(): boolean {
    return this.office.api !== undefined && vscode.workspace.getConfiguration().get<boolean>(PORTRAITS_SETTING, true);
  }

  // A session's portrait: his custom look if he has one, else his seed's. Undefined without the Office.
  icon(seed: string, look: unknown, state: SessionIconState): vscode.Uri | undefined {
    const office = this.office.api;
    if (office === undefined) {
      return undefined;
    }
    const custom = look !== null && typeof look === "object" ? (look as OfficeLook) : undefined;
    const key = `${seed}|${custom === undefined ? "" : JSON.stringify(custom)}|${state}`;
    const cached = this.icons.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const { pulse, dimmed } = badgeStyle(state);
    const svg = office.portraitSvg(custom ?? office.lookFromSeed(seed), { color: this.badgeColor(state), pulse }, dimmed);
    const icon = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    this.icons.set(key, icon);
    return icon;
  }

  dispose(): void {
    this.configListener.dispose();
    this.themeListener.dispose();
    this.officeListener.dispose();
    this.changeEmitter.dispose();
  }

  private badgeColor(state: SessionIconState): string {
    const themeName = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
    const kind = vscode.window.activeColorTheme.kind;
    return badgeColor(state, {
      colorCustomizations: vscode.workspace.getConfiguration("workbench").get<Record<string, unknown>>("colorCustomizations"),
      themeName,
      themeColors: themeName === undefined ? undefined : this.ownThemeColors(themeName),
      isLightTheme: kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight,
    });
  }

  // Only Overseer's own themes can be read; any other theme falls back to the defaults.
  private ownThemeColors(themeName: string): Record<string, unknown> | undefined {
    if (this.themeColorsByName.has(themeName)) {
      return this.themeColorsByName.get(themeName);
    }
    let colors: Record<string, unknown> | undefined;
    try {
      const packageJson = this.extension.packageJSON as { contributes?: { themes?: ContributedTheme[] } };
      const theme = packageJson.contributes?.themes?.find((candidate) => candidate.label === themeName);
      if (typeof theme?.path === "string") {
        const parsed = JSON.parse(fs.readFileSync(path.join(this.extension.extensionPath, theme.path), "utf8")) as { colors?: unknown };
        colors = typeof parsed.colors === "object" && parsed.colors !== null ? (parsed.colors as Record<string, unknown>) : undefined;
      }
    } catch {
      colors = undefined;
    }
    this.themeColorsByName.set(themeName, colors);
    return colors;
  }
}
