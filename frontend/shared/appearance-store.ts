export type Appearance = {
  skin: "orbit" | "ember" | "forest";
  mode: "light" | "dark";
};
export type AppearancePatch = Partial<Appearance>;
export const DEFAULT_APPEARANCE: Appearance = { skin: "orbit", mode: "dark" };
export function validAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Appearance;
  return (
    ["orbit", "ember", "forest"].includes(candidate.skin) &&
    ["light", "dark"].includes(candidate.mode)
  );
}

type Transport = {
  read: () => Promise<unknown>;
  write: (patch: AppearancePatch) => Promise<unknown>;
};

// One account-scoped record and the same synchronization rules on both clients.
export class AppearanceStore {
  private value = DEFAULT_APPEARANCE;
  private pending: AppearancePatch = {};
  private listeners = new Set<() => void>();
  private active = false;
  private writing = false;
  private inFlight: AppearancePatch = {};
  private legacy: Appearance | null = null;
  private reading = false;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private storageKey: string;
  private transport: Transport;
  constructor(scope: string, transport: Transport) {
    this.transport = transport;
    this.storageKey = `khaliduo-appearance-v1:${scope}`;
  }
  snapshot = () => this.value;
  serverSnapshot = () => DEFAULT_APPEARANCE;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Appearance) {
    if (value.skin !== this.value.skin || value.mode !== this.value.mode) {
      this.value = value;
      this.listeners.forEach((listener) => listener());
    }
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          value: this.value,
          pending: { ...this.inFlight, ...this.pending },
        }),
      );
    } catch {
      /* optional storage */
    }
  }
  update = (patch: AppearancePatch) => {
    if (!validAppearance({ ...this.value, ...patch })) return;
    this.generation++;
    this.pending = { ...this.pending, ...patch };
    this.publish({ ...this.value, ...patch });
    void this.flush();
  };
  private async flush() {
    if (!this.active || this.writing || !Object.keys(this.pending).length)
      return;
    this.writing = true;
    const patch = this.pending;
    this.inFlight = patch;
    this.pending = {};
    try {
      const remote = await this.transport.write(patch);
      if (!validAppearance(remote))
        throw new Error("Invalid appearance response");
      this.inFlight = {};
      if (this.active) this.publish({ ...remote, ...this.pending });
    } catch {
      this.inFlight = {};
      this.pending = { ...patch, ...this.pending };
      if (this.active) this.publish(this.value);
      this.writing = false;
      return; // Retry when online, focused, or on the next poll.
    }
    this.writing = false;
    if (this.active && Object.keys(this.pending).length) void this.flush();
  }
  sync = async () => {
    if (!this.active || this.reading || this.writing) return;
    if (Object.keys(this.pending).length) {
      await this.flush();
      return;
    }
    this.reading = true;
    const generation = this.generation;
    try {
      const remote = await this.transport.read();
      if (this.active && generation === this.generation) {
        if (validAppearance(remote)) {
          this.legacy = null;
          this.publish(remote);
        } else if (
          (remote === null ||
            (typeof remote === "object" && Object.keys(remote).length === 0)) &&
          this.legacy
        ) {
          const legacy = this.legacy;
          this.legacy = null;
          this.update(legacy);
        }
      }
    } catch {
      /* Cached preference remains usable while offline. */
    } finally {
      this.reading = false;
    }
  };
  private storageChanged = (event: StorageEvent) => {
    if (
      event.key !== this.storageKey ||
      this.writing ||
      Object.keys(this.pending).length
    )
      return;
    try {
      const record = JSON.parse(event.newValue ?? "null");
      if (validAppearance(record?.value)) {
        this.legacy = record.value;
        // Do not echo storage events back into other tabs.
        this.value = record.value;
        this.generation++;
        this.listeners.forEach((listener) => listener());
      }
    } catch {
      /* malformed browser storage */
    }
    void this.sync();
  };
  start = () => {
    this.active = true;
    try {
      const record = JSON.parse(
        localStorage.getItem(this.storageKey) ?? "null",
      );
      if (validAppearance(record?.value)) {
        this.legacy = record.value;
        const patch = record.pending ?? {};
        this.pending = Object.fromEntries(
          Object.entries(patch).filter(
            ([key, value]) =>
              typeof value === "string" &&
              ((key === "skin" &&
                ["orbit", "ember", "forest"].includes(value)) ||
                (key === "mode" && ["light", "dark"].includes(value))),
          ),
        );
        this.publish(record.value);
      } else if (!localStorage.getItem("khaliduo-appearance-legacy-owner")) {
        const savedMode =
          localStorage.getItem("khaliduo-theme-v2") ??
          localStorage.getItem("khaliduo-theme");
        const savedSkin =
          localStorage.getItem("khaliduo-dashboard-skin-v1") ??
          localStorage.getItem("khaliduo-app-skin-v4");
        const skin = savedSkin === "violet" ? "orbit" : savedSkin;
        if (savedMode || savedSkin) {
          this.legacy = {
            skin: ["orbit", "ember", "forest"].includes(skin ?? "")
              ? (skin as Appearance["skin"])
              : "orbit",
            mode: savedMode === "light" ? "light" : "dark",
          };
          localStorage.setItem(
            "khaliduo-appearance-legacy-owner",
            this.storageKey,
          );
          this.publish(this.legacy);
        }
      }
    } catch {
      /* optional storage */
    }
    void this.sync();
    this.timer = setInterval(() => {
      void this.sync();
    }, 5000);
    window.addEventListener("focus", this.sync);
    window.addEventListener("online", this.sync);
    window.addEventListener("storage", this.storageChanged);
    return () => {
      this.active = false;
      clearInterval(this.timer);
      window.removeEventListener("focus", this.sync);
      window.removeEventListener("online", this.sync);
      window.removeEventListener("storage", this.storageChanged);
    };
  };
}
