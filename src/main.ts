import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  Notice,
  setIcon
} from "obsidian";
import {
  OPDSSettingTab,
  OPDSPluginSettings,
  DEFAULT_SETTINGS,
  DEFAULT_PUBLIC_SERVERS,
  OPDSServerConfig
} from "./settings";
import { OPDSLibraryView, LIBRARY_VIEW_TYPE } from "./views/library-view";
import { OPDSClient, createOPDSClient } from "./opds-client";

export default class OPDSPlugin extends Plugin {
  settings: OPDSPluginSettings;
  libraryView: OPDSLibraryView | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(LIBRARY_VIEW_TYPE, (leaf) => {
      this.libraryView = new OPDSLibraryView(leaf, this);
      return this.libraryView;
    });

    this.addRibbonIcon("book-open", "OPDS Library", () => this.openLibraryView());

    this.addCommand({
      id: "open-opds-library",
      name: "Open OPDS Library",
      callback: () => this.openLibraryView()
    });

    this.addCommand({
      id: "opds-search-books",
      name: "Search Books",
      callback: () => this.openLibraryView()
    });

    this.addSettingTab(new OPDSSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.updateViewReferences();
      })
    );
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(LIBRARY_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<OPDSPluginSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});

    if (!this.settings.defaultServersSeeded) {
      const existingUrls = new Set(
        (saved?.servers ?? this.settings.servers).map(server => server.url)
      );
      const missing = DEFAULT_PUBLIC_SERVERS.filter(server => !existingUrls.has(server.url));
      if (missing.length > 0) {
        const wasEmpty = !saved?.servers || saved.servers.length === 0;
        this.settings.servers = [
          ...saved?.servers ?? this.settings.servers,
          ...missing.map(server => ({ ...server }))
        ];
        if (wasEmpty || this.settings.activeServerIndex < 0) {
          this.settings.activeServerIndex = 0;
        }
      }
      this.settings.defaultServersSeeded = true;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  createConfiguredClient(server: OPDSServerConfig): OPDSClient {
    const auth = server.authType === "none" ? undefined : {
      type: server.authType,
      tokenUrl: server.authType === "oauth2"
        ? (server.oauthTokenUrl?.trim() || server.url.replace(/\/$/, "") + "/token")
        : undefined,
      clientId: server.oauthClientId,
      clientSecret: server.oauthClientSecret,
      scope: server.oauthScope
    };

    const client = createOPDSClient(server.url, auth);

    if (server.authType === "basic" && server.username && server.password) {
      client.setCredentials(server.username, server.password);
    } else if (server.authType === "bearer" && server.token) {
      client.setToken(server.token);
    }

    return client;
  }

  async configureClientAuth(client: OPDSClient, server: OPDSServerConfig): Promise<void> {
    if (server.authType === "oauth2") {
      const token = await client.authenticate();
      if (!token) {
        throw new Error(
          "OAuth2 authentication failed for \"" + server.name + "\". Check Token URL and client credentials."
        );
      }
    }
  }

  getActiveServer(): OPDSServerConfig | null {
    if (this.settings.servers.length === 0) return null;
    const index = this.settings.activeServerIndex >= 0
      ? this.settings.activeServerIndex
      : 0;
    return this.settings.servers[index] || null;
  }

  setActiveServer(index: number): void {
    if (index >= 0 && index < this.settings.servers.length) {
      this.settings.activeServerIndex = index;
      this.saveSettings();
      this.refreshLibraryView();
    }
  }

  async openLibraryView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
      if (leaf) {
        await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  private updateViewReferences(): void {
    const leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (leaves.length > 0) {
      this.libraryView = leaves[0].view as OPDSLibraryView;
    } else {
      this.libraryView = null;
    }
  }

  private async refreshLibraryView(): Promise<void> {
    if (this.libraryView) {
      await this.libraryView.initializeClient();
      await this.libraryView.loadLibrary();
    }
  }

  async testConnection(server: OPDSServerConfig): Promise<boolean> {
    try {
      const client = this.createConfiguredClient(server);
      await this.configureClientAuth(client, server);
      await client.getLibrary();
      return true;
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }

  async downloadBookToVault(url: string, fileName: string): Promise<TFile | null> {
    const server = this.getActiveServer();
    if (!server) {
      new Notice("No OPDS server configured");
      return null;
    }

    try {
      const client = this.createConfiguredClient(server);
      await this.configureClientAuth(client, server);

      const arrayBuffer = await client.downloadBook(url);
      const folderPath = this.settings.downloadPath;
      const filePath = `${folderPath}/${fileName}`;

      let file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.app.vault.modifyBinary(file, arrayBuffer);
      } else {
        file = await this.app.vault.createBinary(filePath, arrayBuffer);
      }

      new Notice(`Downloaded: ${fileName}`);
      return file;
    } catch (error) {
      console.error("Download failed:", error);
      new Notice(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}