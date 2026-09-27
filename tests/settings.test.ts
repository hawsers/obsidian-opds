import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_PUBLIC_SERVERS,
  OPDSServerConfig,
  OPDSPluginSettings,
  RefreshStatus
} from "../src/settings";

describe("DEFAULT_SETTINGS", () => {
  it("seeds no public servers", () => {
    expect(DEFAULT_SETTINGS.servers).toHaveLength(0);
    expect(DEFAULT_SETTINGS.servers).toEqual(DEFAULT_PUBLIC_SERVERS);
    expect(DEFAULT_SETTINGS.servers.every(s => s.authType === "none")).toBe(true);
    expect(DEFAULT_SETTINGS.servers.map(s => s.name)).toEqual([]);
  });

  it("starts at server index 0", () => {
    expect(DEFAULT_SETTINGS.activeServerIndex).toBe(0);
  });

  it("does not consider public servers seeded until loadSettings runs", () => {
    expect(DEFAULT_SETTINGS.defaultServersSeeded).toBe(false);
  });

  it("has default downloadPath of Books", () => {
    expect(DEFAULT_SETTINGS.downloadPath).toBe("Books");
  });

  it("has autoDownloadCover enabled", () => {
    expect(DEFAULT_SETTINGS.autoDownloadCover).toBe(true);
  });

  it("has maxConcurrentDownloads of 3", () => {
    expect(DEFAULT_SETTINGS.maxConcurrentDownloads).toBe(3);
  });

  it("has preferredFormat of pdf", () => {
    expect(DEFAULT_SETTINGS.preferredFormat).toBe("pdf");
  });

  it("has empty refreshStatuses", () => {
    expect(DEFAULT_SETTINGS.refreshStatuses).toEqual({});
  });
});

describe("OPDSServerConfig", () => {
  it("can create a minimal server config", () => {
    const server: OPDSServerConfig = {
      name: "Test Server",
      url: "http://localhost:3000/opds",
      authType: "none"
    };
    expect(server.name).toBe("Test Server");
    expect(server.authType).toBe("none");
  });

  it("can create a basic auth server config", () => {
    const server: OPDSServerConfig = {
      name: "Basic Auth",
      url: "http://localhost:3000/opds",
      authType: "basic",
      username: "admin",
      password: "secret"
    };
    expect(server.username).toBe("admin");
    expect(server.password).toBe("secret");
  });

  it("can create a bearer token server config", () => {
    const server: OPDSServerConfig = {
      name: "Bearer Auth",
      url: "http://localhost:3000/opds",
      authType: "bearer",
      token: "my-token-123"
    };
    expect(server.token).toBe("my-token-123");
  });

  it("can create an OAuth2 server config", () => {
    const server: OPDSServerConfig = {
      name: "OAuth2 Server",
      url: "http://localhost:3000/opds",
      authType: "oauth2",
      oauthTokenUrl: "http://localhost:3000/oauth/token",
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      oauthScope: "read write"
    };
    expect(server.oauthTokenUrl).toBe("http://localhost:3000/oauth/token");
    expect(server.oauthClientId).toBe("client-id");
    expect(server.oauthClientSecret).toBe("client-secret");
    expect(server.oauthScope).toBe("read write");
  });

  it("allows OAuth2 config without explicit token URL (defaults applied at client build)", () => {
    const server: OPDSServerConfig = {
      name: "OAuth2 Default Token URL",
      url: "http://localhost:3000/opds",
      authType: "oauth2",
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret"
    };
    expect(server.oauthTokenUrl).toBeUndefined();
  });
});

describe("RefreshStatus", () => {
  it("can create a success status", () => {
    const status: RefreshStatus = {
      success: true,
      message: "Found 5 catalogs",
      lastRefresh: Date.now(),
      catalogCount: 5
    };
    expect(status.success).toBe(true);
    expect(status.catalogCount).toBe(5);
  });

  it("can create an error status", () => {
    const status: RefreshStatus = {
      success: false,
      message: "Connection refused",
      lastRefresh: Date.now(),
      catalogCount: 0
    };
    expect(status.success).toBe(false);
    expect(status.catalogCount).toBe(0);
  });

  it("supports optional opdsVersion", () => {
    const status: RefreshStatus = {
      success: true,
      message: "OK",
      lastRefresh: Date.now(),
      catalogCount: 1,
      opdsVersion: "OPDS 1.2"
    };
    expect(status.opdsVersion).toBe("OPDS 1.2");
  });

  it("allows opdsVersion to be omitted", () => {
    const status: RefreshStatus = {
      success: true,
      message: "OK",
      lastRefresh: Date.now(),
      catalogCount: 1
    };
    expect(status.opdsVersion).toBeUndefined();
  });
});

describe("OPDSPluginSettings", () => {
  it("supports multiple servers", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [
        { name: "Server 1", url: "http://server1.com/opds", authType: "none" },
        { name: "Server 2", url: "http://server2.com/opds", authType: "basic", username: "u", password: "p" }
      ],
      activeServerIndex: 0
    };
    expect(settings.servers).toHaveLength(2);
    expect(settings.activeServerIndex).toBe(0);
  });

  it("supports refresh statuses per server URL", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      refreshStatuses: {
        "http://server1.com/opds": { success: true, message: "OK", lastRefresh: 1000, catalogCount: 3 },
        "http://server2.com/opds": { success: false, message: "Error", lastRefresh: 2000, catalogCount: 0 }
      }
    };
    expect(Object.keys(settings.refreshStatuses)).toHaveLength(2);
    expect(settings.refreshStatuses["http://server1.com/opds"].success).toBe(true);
    expect(settings.refreshStatuses["http://server2.com/opds"].success).toBe(false);
  });

  it("can have negative activeServerIndex when no servers", () => {
    const settings: OPDSPluginSettings = { ...DEFAULT_SETTINGS, servers: [], activeServerIndex: -1 };
    expect(settings.activeServerIndex).toBe(-1);
  });

  it("preferredFormat can be any", () => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      preferredFormat: "any"
    };
    expect(settings.preferredFormat).toBe("any");
  });
});

describe("default server seeding", () => {
  type LoadSettings = (saved: Partial<OPDSPluginSettings> | null) => {
    settings: OPDSPluginSettings;
    shouldSave: boolean;
  };

  const loadSettings: LoadSettings = (saved) => {
    const settings: OPDSPluginSettings = {
      ...DEFAULT_SETTINGS,
      servers: [...DEFAULT_PUBLIC_SERVERS],
      refreshStatuses: {},
      ...(saved ?? {})
    };
    let shouldSave = false;

    if (!settings.defaultServersSeeded) {
      const existingUrls = new Set(
        (saved?.servers ?? settings.servers).map(server => server.url)
      );
      const missing = DEFAULT_PUBLIC_SERVERS.filter(server => !existingUrls.has(server.url));
      if (missing.length > 0) {
        const wasEmpty = !saved?.servers || saved.servers.length === 0;
        settings.servers = [
          ...saved?.servers ?? settings.servers,
          ...missing.map(server => ({ ...server }))
        ];
        if (wasEmpty || settings.activeServerIndex < 0) {
          settings.activeServerIndex = 0;
        }
      }
      settings.defaultServersSeeded = true;
      shouldSave = true;
    }

    return { settings, shouldSave };
  };

  it("sets the seeded flag for fresh installs", () => {
    const { settings, shouldSave } = loadSettings(null);
    expect(settings.servers).toHaveLength(0);
    expect(settings.activeServerIndex).toBe(0);
    expect(settings.defaultServersSeeded).toBe(true);
    expect(shouldSave).toBe(true);
  });

  it("leaves existing installs with empty servers untouched", () => {
    const { settings, shouldSave } = loadSettings({
      servers: [],
      activeServerIndex: -1,
      defaultServersSeeded: false
    });
    expect(settings.servers).toHaveLength(0);
    expect(settings.activeServerIndex).toBe(-1);
    expect(shouldSave).toBe(true);
  });

  it("leaves user-configured servers untouched when defaults are empty", () => {
    const custom = [{ name: "Mine", url: "https://example.com/opds", authType: "none" as const }];
    const { settings, shouldSave } = loadSettings({
      servers: custom,
      activeServerIndex: 0,
      defaultServersSeeded: false
    });
    expect(settings.servers).toHaveLength(1);
    expect(settings.servers[0]).toEqual(custom[0]);
    expect(settings.servers.map(s => s.name)).toEqual(["Mine"]);
    expect(settings.activeServerIndex).toBe(0);
    expect(settings.defaultServersSeeded).toBe(true);
    expect(shouldSave).toBe(true);
  });

  it("does not duplicate defaults already present", () => {
    const { settings, shouldSave } = loadSettings({
      servers: [
        { name: "Feedbooks", url: "https://feedbooks.github.io/opds-test-catalog/catalog/root.xml", authType: "none" }
      ],
      activeServerIndex: 0,
      defaultServersSeeded: false
    });
    expect(settings.servers).toHaveLength(1);
    expect(settings.servers.filter(s => s.url === "https://feedbooks.github.io/opds-test-catalog/catalog/root.xml")).toHaveLength(1);
    expect(settings.servers.map(s => s.name)).toEqual(["Feedbooks"]);
    expect(shouldSave).toBe(true);
  });

  it("does not re-seed after the flag is set", () => {
    const { settings, shouldSave } = loadSettings({
      servers: [],
      activeServerIndex: -1,
      defaultServersSeeded: true
    });
    expect(settings.servers).toEqual([]);
    expect(settings.activeServerIndex).toBe(-1);
    expect(shouldSave).toBe(false);
  });
});
