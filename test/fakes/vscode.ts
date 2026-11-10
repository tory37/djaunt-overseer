// A small stand-in for the `vscode` module, enough to run the Office bridge in unit tests (from vscode-office-simulation). Tests reach its state
// through `fake`.

type Listener<T> = (value: T) => void;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return new Disposable(() => (this.listeners = this.listeners.filter((other) => other !== listener)));
  };
  fire(value: T): void {
    this.listeners.forEach((listener) => listener(value));
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Disposable {
  constructor(private readonly onDispose: () => void = () => undefined) {}
  dispose(): void {
    this.onDispose();
  }
}

export class Uri {
  constructor(readonly fsPath: string, readonly query = "") {}
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri([base.fsPath, ...parts].join("/"));
  }
  static parse(text: string): Uri {
    return new Uri(text);
  }
  static file(path: string): Uri {
    return new Uri(path);
  }
  with(change: { query?: string }): Uri {
    return new Uri(this.fsPath, change.query ?? this.query);
  }
  toString(): string {
    return this.fsPath.includes("://") ? this.fsPath : `file://${this.fsPath}${this.query ? `?${this.query}` : ""}`;
  }
}

export const ConfigurationTarget = { Global: 1 };
export const QuickPickItemKind = { Separator: -1 };

const configChange = new EventEmitter<{ affectsConfiguration: (key: string) => boolean }>();

const extensionsChange = new EventEmitter<void>();

export const fake = {
  extensions: new Map<string, { isActive: boolean; exports: unknown; activate: () => Promise<unknown> }>(),
  opened: [] as string[],
  shown: [] as string[],
  // Installs (or removes, with undefined) an extension whose activate() returns this API.
  setExtension(id: string, api: unknown): void {
    if (api === undefined) {
      this.extensions.delete(id);
    } else {
      this.extensions.set(id, { isActive: true, exports: api, activate: async () => api });
    }
    extensionsChange.fire();
  },
  settings: new Map<string, unknown>(),
  commands: [] as { command: string; args: unknown[] }[],
  registered: new Map<string, (...args: unknown[]) => unknown>(),
  setSetting(key: string, value: unknown): void {
    this.settings.set(key, value);
    configChange.fire({ affectsConfiguration: (changed) => key === changed || key.startsWith(`${changed}.`) });
  },
  reset(): void {
    this.extensions.clear();
    this.opened = [];
    this.shown = [];
    this.settings.clear();
    this.commands = [];
    this.registered.clear();
  },
};

export const workspace = {
  getConfiguration: () => ({
    get: <T>(key: string, fallback?: T) => (fake.settings.has(key) ? (fake.settings.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => fake.setSetting(key, value),
    inspect: (key: string) => ({ globalValue: fake.settings.get(key) }),
  }),
  onDidChangeConfiguration: configChange.event,
};

export const commands = {
  executeCommand: async (command: string, ...args: unknown[]) => {
    fake.commands.push({ command, args });
  },
  registerCommand: (command: string, handler: (...args: unknown[]) => unknown) => {
    fake.registered.set(command, handler);
    return new Disposable(() => fake.registered.delete(command));
  },
};

export const extensions = {
  getExtension: (id: string) => fake.extensions.get(id),
  onDidChange: extensionsChange.event,
};

export const env = {
  openExternal: async (uri: Uri) => {
    fake.opened.push(uri.toString());
    return true;
  },
};

export const window = {
  showInformationMessage: async (message: string) => {
    fake.shown.push(message);
    return undefined;
  },
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  registerWebviewViewProvider: () => new Disposable(),
};

// A webview view whose posted messages the test can read, and that the test can send messages from.
export class FakeWebviewView {
  readonly posted: { type?: string; [key: string]: unknown }[] = [];
  visible = true;
  private readonly received = new EventEmitter<unknown>();
  private readonly disposed = new EventEmitter<void>();
  readonly webview = {
    options: {},
    html: "",
    cspSource: "fake-csp",
    asWebviewUri: (uri: Uri) => uri,
    postMessage: async (message: { type?: string }) => {
      this.posted.push(message);
      return true;
    },
    onDidReceiveMessage: this.received.event,
  };
  onDidDispose = this.disposed.event;
  send(message: unknown): void {
    this.received.fire(message);
  }
  dispose(): void {
    this.disposed.fire();
  }
  last(type: string): { [key: string]: unknown } | undefined {
    return [...this.posted].reverse().find((message) => message.type === type);
  }
}
