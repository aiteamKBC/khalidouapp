import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, WebContents } from "electron";
import type { FeedQuote, QuoteFeedLanguage, QuoteProvider } from "./quoteFeed.js";

export type QuoteReminderPayload = {
  text: string;
  colors: Record<string, string>;
  preferExternal?: boolean;
  author?: string;
  provider?: QuoteProvider;
  sequence?: number;
};

type QuoteReminderWindowOptions = {
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  loadWindow: (window: BrowserWindow) => Promise<void>;
  getWorkArea: () => Rectangle;
  preload: string;
  resolveQuote?: (language: QuoteFeedLanguage, sequence: number) => Promise<FeedQuote | null>;
};

const COLOR_KEYS = ["--k-card", "--k-line", "--k-ink", "--k-muted", "--k-bg-2", "--k-pink"];

export class QuoteReminderWindow {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private payload: QuoteReminderPayload | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private area: Rectangle | null = null;
  private options: QuoteReminderWindowOptions;
  private requestVersion = 0;

  constructor(options: QuoteReminderWindowOptions) {
    this.options = options;
  }

  owns(sender: WebContents) {
    return this.window?.webContents === sender;
  }

  getPayload(sender: WebContents) {
    return this.owns(sender) ? this.payload : null;
  }

  async show(input: unknown) {
    if (!input || typeof input !== "object") return;
    const candidate = input as Partial<QuoteReminderPayload>;
    if (typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 500) return;
    const colors = Object.fromEntries(COLOR_KEYS.flatMap(key => {
      const color = candidate.colors?.[key];
      return typeof color === "string" && color.length <= 128 ? [[key, color]] : [];
    }));
    this.dismiss();
    const requestVersion = this.requestVersion;
    const language = /[\u0600-\u06ff]/.test(candidate.text) ? "ar" : "en";
    const sequence = Number.isSafeInteger(candidate.sequence) && candidate.sequence! >= 0 ? candidate.sequence! : 0;
    const external = candidate.preferExternal === true
      ? await this.options.resolveQuote?.(language, sequence).catch(() => null)
      : null;
    // Opt-out, sign-out, or a newer reminder can arrive during the HTTP request.
    if (requestVersion !== this.requestVersion) return;
    const payload: QuoteReminderPayload = external
      ? { text: external.text, author: external.author, provider: external.provider, colors }
      : { text: candidate.text, colors };
    this.payload = payload;
    this.area = this.options.getWorkArea();

    if (!this.window || this.window.isDestroyed()) {
      const window = this.options.createWindow({
        ...this.bounds(200),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        title: "Khaliduo Quote",
        webPreferences: {
          preload: this.options.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      this.window = window;
      window.setMenuBarVisibility(false);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", event => event.preventDefault());
      window.on("closed", () => {
        if (this.window === window) {
          this.dismiss();
          this.window = null;
          this.ready = null;
        }
      });
      this.ready = this.options.loadWindow(window);
    }

    const window = this.window;
    try {
      await this.ready;
      if (this.payload !== payload || this.window !== window || window.isDestroyed()) return;
      window.setBounds(this.bounds(window.getBounds().height));
      window.webContents.send("quote:changed", payload);
      // Stay outside the app without interrupting typing in another program.
      window.showInactive();
      this.timer = setTimeout(() => this.dismiss(), 20_000);
      this.timer.unref();
    } catch (error) {
      if (this.payload === payload) this.dispose();
      throw error;
    }
  }

  resize(sender: WebContents, height: unknown) {
    if (!this.owns(sender) || !this.payload || typeof height !== "number" || !Number.isFinite(height)) return;
    this.window?.setBounds(this.bounds(height));
  }

  private bounds(height: number): Rectangle {
    const area = this.area!;
    const margin = 16;
    const width = Math.max(1, Math.min(380, area.width - margin * 2));
    const boundedHeight = Math.max(1, Math.min(Math.max(120, Math.ceil(height)), 420, area.height - margin * 2));
    return {
      x: area.x + area.width - width - margin,
      y: area.y + area.height - boundedHeight - margin,
      width,
      height: boundedHeight,
    };
  }

  dismiss() {
    this.requestVersion++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.payload = null;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  dispose() {
    this.dismiss();
    const window = this.window;
    this.window = null;
    this.ready = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
