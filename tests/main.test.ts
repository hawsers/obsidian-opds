import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, OPDSPluginSettings, OPDSServerConfig } from "../src/settings";

describe("Plugin getActiveServer logic", () => {
  function getActiveServer(settings: OPDSPluginSettings): OPDSServerConfig | null {
    if (settings.servers.length === 0) return null;
    const index = settings.activeServerIndex >= 0 ? settings.activeServerIndex : 0;
    return settings.servers[index] || null;
  }

  it("returns null when no servers", () => {
    const settings = { ...DEFAULT_SETTINGS, servers: [], activeServerIndex: -1 };
    expect(getActiveServer(settings)).toBeNull();
  });

  it("returns first server when activeServerIndex is -1", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "Server A", url: "http://a.com", authType: "none" },
        { name: "Server B", url: "http://b.com", authType: "none" }
      ],
      activeServerIndex: -1
    };
    expect(getActiveServer(settings)!.name).toBe("Server A");
  });

  it("returns correct server by index", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "Server A", url: "http://a.com", authType: "none" },
        { name: "Server B", url: "http://b.com", authType: "none" }
      ],
      activeServerIndex: 1
    };
    expect(getActiveServer(settings)!.name).toBe("Server B");
  });

  it("returns null if activeServerIndex exceeds array bounds", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [{ name: "Only", url: "http://only.com", authType: "none" }],
      activeServerIndex: 5
    };
    expect(getActiveServer(settings)).toBeNull();
  });
});

describe("setActiveServer logic", () => {
  function setActiveServer(settings: OPDSPluginSettings, index: number): OPDSPluginSettings {
    if (index >= 0 && index < settings.servers.length) {
      return { ...settings, activeServerIndex: index };
    }
    return settings;
  }

  it("sets valid index", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "A", url: "http://a.com", authType: "none" },
        { name: "B", url: "http://b.com", authType: "none" }
      ],
      activeServerIndex: 0
    };
    const updated = setActiveServer(settings, 1);
    expect(updated.activeServerIndex).toBe(1);
  });

  it("rejects negative index", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [{ name: "A", url: "http://a.com", authType: "none" }],
      activeServerIndex: 0
    };
    const updated = setActiveServer(settings, -1);
    expect(updated.activeServerIndex).toBe(0);
  });

  it("rejects index beyond array length", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [{ name: "A", url: "http://a.com", authType: "none" }],
      activeServerIndex: 0
    };
    const updated = setActiveServer(settings, 5);
    expect(updated.activeServerIndex).toBe(0);
  });
});

describe("Delete server logic", () => {
  function deleteServer(settings: OPDSPluginSettings, index: number): OPDSPluginSettings {
    const servers = [...settings.servers];
    servers.splice(index, 1);
    let activeIndex = settings.activeServerIndex;
    if (activeIndex >= index) {
      activeIndex = Math.max(0, activeIndex - 1);
    }
    if (servers.length === 0) {
      activeIndex = -1;
    }
    return { ...settings, servers, activeServerIndex: activeIndex };
  }

  it("removes a server", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "A", url: "http://a.com", authType: "none" },
        { name: "B", url: "http://b.com", authType: "none" },
        { name: "C", url: "http://c.com", authType: "none" }
      ],
      activeServerIndex: 1
    };
    const updated = deleteServer(settings, 1);
    expect(updated.servers).toHaveLength(2);
    expect(updated.servers.map(s => s.name)).toEqual(["A", "C"]);
  });

  it("adjusts active index when deleting active server", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "A", url: "http://a.com", authType: "none" },
        { name: "B", url: "http://b.com", authType: "none" }
      ],
      activeServerIndex: 1
    };
    const updated = deleteServer(settings, 1);
    expect(updated.activeServerIndex).toBe(0);
  });

  it("adjusts active index when deleting server before active", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "A", url: "http://a.com", authType: "none" },
        { name: "B", url: "http://b.com", authType: "none" },
        { name: "C", url: "http://c.com", authType: "none" }
      ],
      activeServerIndex: 2
    };
    const updated = deleteServer(settings, 0);
    expect(updated.activeServerIndex).toBe(1);
  });

  it("sets activeServerIndex to -1 when all servers deleted", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [{ name: "Only", url: "http://only.com", authType: "none" }],
      activeServerIndex: 0
    };
    const updated = deleteServer(settings, 0);
    expect(updated.activeServerIndex).toBe(-1);
    expect(updated.servers).toHaveLength(0);
  });
});

describe("Add server logic", () => {
  it("adds server and sets active index to 0 if was -1", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [],
      activeServerIndex: -1
    };
    const newServer: OPDSServerConfig = { name: "New", url: "http://new.com", authType: "none" };
    const servers = [...settings.servers, newServer];
    const activeIndex = settings.activeServerIndex === -1 ? 0 : settings.activeServerIndex;
    const updated = { ...settings, servers, activeServerIndex: activeIndex };
    expect(updated.servers).toHaveLength(1);
    expect(updated.activeServerIndex).toBe(0);
  });

  it("preserves active index when adding to existing servers", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [{ name: "Existing", url: "http://existing.com", authType: "none" }],
      activeServerIndex: 0
    };
    const newServer: OPDSServerConfig = { name: "New", url: "http://new.com", authType: "none" };
    const servers = [...settings.servers, newServer];
    const updated = { ...settings, servers };
    expect(updated.servers).toHaveLength(2);
    expect(updated.activeServerIndex).toBe(0);
  });
});
