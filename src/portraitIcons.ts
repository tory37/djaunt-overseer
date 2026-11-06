import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { pixelGuyLook, portraitSvg } from "./pixelGuy";
import { badgeColor, badgeStyle } from "./portraitBadge";
import { SessionIconState } from "./sessionIcons";

const PORTRAITS_SETTING = "overseer.office.portraits";

interface ContributedTheme {
  label?: unknown;
  path?: unknown;
}

// The session rows' pixel-guy portraits, as data URIs, cached by seed and state. The badge colors are read once per
// theme or color customization change.
export class PortraitIcons implements vscode.Disposable {
  private readonly icons = new Map<string, vscode.Uri>();
  private readonly themeColorsByName = new Map<string, Record<string, unknown> | undefined>();
  private readonly configListener: vscode.Disposable;
  private readonly themeListener: vscode.Disposable;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly extension: vscode.Extension<unknown>) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration("workbench.colorCustomizations") || change.affectsConfiguration("workbench.colorTheme") ||
        change.affectsConfiguration(PORTRAITS_SETTING)) {
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
    return vscode.workspace.getConfiguration().get<boolean>(PORTRAITS_SETTING, true);
  }

  icon(seed: string, state: SessionIconState): vscode.Uri {
    const key = `${seed}|${state}`;
    const cached = this.icons.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const { pulse, dimmed } = badgeStyle(state);
    const svg = portraitSvg(pixelGuyLook(seed), { color: this.badgeColor(state), pulse }, dimmed);
    const icon = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    this.icons.set(key, icon);
    return icon;
  }

  dispose(): void {
    this.configListener.dispose();
    this.themeListener.dispose();
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
