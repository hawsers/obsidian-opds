import { PluginSettingTab, Setting, App, Modal, Notice } from "obsidian";
import OPDSPlugin from "./main";

export interface OPDSServerConfig {
  name: string;
  url: string;
  username?: string;
  password?: string;
  token?: string;
  authType: "none" | "basic" | "bearer" | "oauth2";
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
}

export interface OPDSPluginSettings {
  servers: OPDSServerConfig[];
  activeServerIndex: number;
  downloadPath: string;
  autoDownloadCover: boolean;
  maxConcurrentDownloads: number;
  preferredFormat: "epub" | "pdf" | "mobi" | "any";
  refreshStatuses: Record<string, RefreshStatus>;
  defaultServersSeeded: boolean;
}

export interface RefreshStatus {
  success: boolean;
  message: string;
  lastRefresh: number;
  catalogCount: number;
  opdsVersion?: string;
}

export const DEFAULT_PUBLIC_SERVERS: OPDSServerConfig[] = [];

export const DEFAULT_SETTINGS: OPDSPluginSettings = {
  servers: [...DEFAULT_PUBLIC_SERVERS],
  activeServerIndex: 0,
  downloadPath: "Books",
  autoDownloadCover: true,
  maxConcurrentDownloads: 3,
  preferredFormat: "pdf",
  refreshStatuses: {},
  defaultServersSeeded: false
};

export class OPDSSettingTab extends PluginSettingTab {
  plugin: OPDSPlugin;

  constructor(app: App, plugin: OPDSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OPDS Client Settings" });

    this.renderServersSection();
    this.renderGeneralSettings();
    void this.detectMissingVersions();
  }

  private async detectMissingVersions(): Promise<void> {
    const { settings } = this.plugin;
    const pending = settings.servers.filter(server => {
      const status = settings.refreshStatuses[server.url];
      return !status?.opdsVersion;
    });
    if (pending.length === 0) return;

    await Promise.all(pending.map(async (server) => {
      try {
        const client = this.plugin.createConfiguredClient(server);
        await this.plugin.configureClientAuth(client, server);
        const opdsVersion = await client.detectOpdsVersion();
        const existing = settings.refreshStatuses[server.url];
        if (existing) {
          existing.opdsVersion = opdsVersion;
        } else {
          settings.refreshStatuses[server.url] = {
            success: true,
            message: "Version detected",
            lastRefresh: Date.now(),
            catalogCount: 0,
            opdsVersion
          };
        }
      } catch {
        // leave as Unknown
      }
    }));

    await this.plugin.saveSettings();
    if (this.containerEl && this.containerEl.isConnected !== false) {
      this.display();
    }
  }

  private renderServersSection(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;

    containerEl.createEl("h3", { text: "OPDS Servers" });

    if (settings.servers.length === 0) {
      containerEl.createEl("p", {
        text: "No servers configured. Add your first OPDS server below.",
        cls: "opds-empty-state"
      });
    }

    settings.servers.forEach((server, index) => {
      const isActive = index === settings.activeServerIndex;
      const status = settings.refreshStatuses[server.url];
      const serverDiv = containerEl.createDiv({ cls: "opds-server-card" + (isActive ? " active" : "") });

      const header = serverDiv.createDiv({ cls: "opds-server-header" });
      header.createEl("strong", { text: server.name || `Server ${index + 1}` });
      if (isActive) {
        header.createEl("span", { text: " (Active)", cls: "opds-active-badge" });
      }

      const details = serverDiv.createDiv({ cls: "opds-server-details" });
      details.createEl("span", { text: server.url, cls: "opds-server-url" });
      details.createEl("span", { text: "Auth: " + server.authType, cls: "opds-server-auth" });

      const version = status?.opdsVersion;
      details.createEl("span", {
        text: "OPDS: " + (version || "Detecting…"),
        cls: "opds-server-version" + (version ? " opds-version-known" : "")
      });

      if (status) {
        const statusEl = details.createEl("span", {
          cls: "opds-server-status " + (status.success ? "opds-status-ok" : "opds-status-error"),
          text: (status.success ? "OK: " : "Error: ") + status.message
        });
      }

      const actions = serverDiv.createDiv({ cls: "opds-server-actions" });

      const refreshBtn = actions.createEl("button", { text: "Refresh" });
      refreshBtn.onclick = async () => {
        refreshBtn.disabled = true;
        refreshBtn.setText("Refreshing...");
        try {
          const client = this.plugin.createConfiguredClient(server);
          await this.plugin.configureClientAuth(client, server);
          const [library, opdsVersion] = await Promise.all([
            client.getLibrary(),
            client.detectOpdsVersion().catch(() => "Unknown")
          ]);
          settings.refreshStatuses[server.url] = {
            success: true,
            message: "Found " + library.catalogs.length + " catalogs",
            lastRefresh: Date.now(),
            catalogCount: library.catalogs.length,
            opdsVersion
          };
        } catch (error) {
          settings.refreshStatuses[server.url] = {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            lastRefresh: Date.now(),
            catalogCount: 0,
            opdsVersion: "Unknown"
          };
        }
        await this.plugin.saveSettings();
        this.display();
      };

      if (!isActive) {
        const activateBtn = actions.createEl("button", { text: "Activate", cls: "mod-cta" });
        activateBtn.onclick = () => {
          this.plugin.setActiveServer(index);
          this.display();
        };
      }

      const editBtn = actions.createEl("button", { text: "Edit" });
      editBtn.onclick = () => this.showServerModal(index);

      const deleteBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
      deleteBtn.onclick = () => {
        const modal = new Modal(this.plugin.app);
        const content = modal.contentEl;
        content.createEl("h3", { text: `Delete server "${server.name}"?` });
        const btnContainer = content.createDiv({ cls: "opds-modal-actions" });
        const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => modal.close();
        const confirmBtn = btnContainer.createEl("button", { text: "Delete", cls: "mod-warning" });
        confirmBtn.onclick = async () => {
          settings.servers.splice(index, 1);
          if (settings.servers.length === 0) {
            settings.activeServerIndex = -1;
          } else if (settings.activeServerIndex >= index) {
            settings.activeServerIndex = Math.max(0, settings.activeServerIndex - 1);
          }
          await this.plugin.saveSettings();
          this.display();
          modal.close();
        };
        modal.open();
      };
    });

    const addBtn = containerEl.createEl("button", {
      text: "+ Add OPDS Server",
      cls: "mod-cta opds-add-server-btn"
    });
    addBtn.onclick = () => this.showServerModal();
  }

  private showServerModal(editIndex?: number): void {
    const { settings } = this.plugin;
    const isEdit = editIndex !== undefined;
    const server = isEdit ? settings.servers[editIndex!] : {
      name: "",
      url: "",
      authType: "none" as const
    };

    const modal = new ServerModal(this.app, server, isEdit, async (result) => {
      if (isEdit) {
        settings.servers[editIndex!] = result;
      } else {
        settings.servers.push(result);
        if (settings.activeServerIndex === -1) {
          settings.activeServerIndex = 0;
        }
      }
      await this.plugin.saveSettings();
      this.display();
    });
    modal.open();
  }

  private renderGeneralSettings(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;

    containerEl.createEl("h3", { text: "General Settings" });

    new Setting(containerEl)
      .setName("Download folder")
      .setDesc("Folder where downloaded books will be saved (relative to vault root)")
      .addText(text => text
        .setPlaceholder("Books")
        .setValue(settings.downloadPath)
        .onChange(async (value) => {
          settings.downloadPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Auto-download covers")
      .setDesc("Automatically download book cover images")
      .addToggle(toggle => toggle
        .setValue(settings.autoDownloadCover)
        .onChange(async (value) => {
          settings.autoDownloadCover = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Max concurrent downloads")
      .setDesc("Maximum number of simultaneous downloads")
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(settings.maxConcurrentDownloads)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.maxConcurrentDownloads = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Preferred format")
      .setDesc("Preferred ebook format when multiple are available")
      .addDropdown(dropdown => dropdown
        .addOption("epub", "EPUB")
        .addOption("pdf", "PDF")
        .addOption("mobi", "MOBI")
        .addOption("any", "Any available")
        .setValue(settings.preferredFormat)
        .onChange(async (value) => {
          settings.preferredFormat = value as any;
          await this.plugin.saveSettings();
        }));
  }
}

class ServerModal extends Modal {
  private server: OPDSServerConfig;
  private isEdit: boolean;
  private onSubmit: (server: OPDSServerConfig) => void;

  constructor(app: App, server: OPDSServerConfig, isEdit: boolean, onSubmit: (server: OPDSServerConfig) => void) {
    super(app);
    this.server = { ...server };
    this.isEdit = isEdit;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.isEdit ? "Edit OPDS Server" : "Add OPDS Server" });

    const form = contentEl.createEl("form");

    this.createField(form, "text", "Name", "name", "My OPDS Server", this.server.name, false);
    this.createField(form, "url", "Server URL", "url", "https://example.com/opds", this.server.url, true);

    const authTypeField = form.createDiv({ cls: "opds-field" });
    authTypeField.createEl("label", { text: "Authentication" });
    const authSelect = authTypeField.createEl("select", { attr: { name: "authType" } });
    authSelect.createEl("option", { text: "None", value: "none" }).selected = this.server.authType === "none";
    authSelect.createEl("option", { text: "Basic Auth", value: "basic" }).selected = this.server.authType === "basic";
    authSelect.createEl("option", { text: "Bearer Token", value: "bearer" }).selected = this.server.authType === "bearer";
    authSelect.createEl("option", { text: "OAuth2", value: "oauth2" }).selected = this.server.authType === "oauth2";

    const authFields = form.createDiv({ cls: "opds-auth-fields" });
    this.renderAuthFields(authFields);

    authSelect.addEventListener("change", () => {
      this.server.authType = authSelect.value as any;
      this.renderAuthFields(authFields);
    });

    const actions = form.createDiv({ cls: "opds-modal-actions" });
    actions.createEl("button", { text: "Cancel", attr: { type: "button" } }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: this.isEdit ? "Save" : "Add", cls: "mod-cta", attr: { type: "submit" } });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitForm(form);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private createField(container: HTMLElement, type: string, label: string, name: string, placeholder: string, value: string, required: boolean): void {
    const div = container.createDiv({ cls: "opds-field" });
    div.createEl("label", { text: `${label}${required ? " *" : ""}` });
    div.createEl("input", {
      attr: { type, name, placeholder, value: value || "", required: required || undefined }
    });
  }

  private renderAuthFields(container: HTMLElement): void {
    container.empty();
    const { authType, username, password, token, oauthTokenUrl, oauthClientId, oauthClientSecret, oauthScope } = this.server;

    if (authType === "basic") {
      this.createField(container, "text", "Username", "username", "username", username || "", false);
      this.createField(container, "password", "Password", "password", "password", password || "", false);
    } else if (authType === "bearer") {
      this.createField(container, "text", "Bearer Token", "token", "Bearer token", token || "", false);
    } else if (authType === "oauth2") {
      this.createField(container, "url", "Token URL", "oauthTokenUrl", "https://example.com/oauth/token (defaults to Server URL + /token)", oauthTokenUrl || "", false);
      this.createField(container, "text", "Client ID", "oauthClientId", "Client ID", oauthClientId || "", false);
      this.createField(container, "password", "Client Secret", "oauthClientSecret", "Client Secret", oauthClientSecret || "", false);
      this.createField(container, "text", "Scope (optional)", "oauthScope", "Scope", oauthScope || "", false);
    }
  }

  private submitForm(form: HTMLFormElement): void {
    const formData = new FormData(form);
    const url = formData.get("url") as string;

    if (!url || !url.trim()) {
      new Notice("Server URL is required");
      return;
    }

    try {
      new URL(url);
    } catch {
      new Notice("Invalid URL. Include the protocol (e.g., https://)");
      return;
    }

    const result: OPDSServerConfig = {
      name: formData.get("name") as string,
      url: url,
      authType: formData.get("authType") as any
    };

    const authType = result.authType;
    if (authType === "basic") {
      result.username = formData.get("username") as string;
      result.password = formData.get("password") as string;
    } else if (authType === "bearer") {
      result.token = formData.get("token") as string;
    } else if (authType === "oauth2") {
      const tokenUrl = (formData.get("oauthTokenUrl") as string) || "";
      if (tokenUrl.trim()) {
        try {
          new URL(tokenUrl);
          result.oauthTokenUrl = tokenUrl;
        } catch {
          new Notice("Invalid Token URL. Include the protocol (e.g., https://)");
          return;
        }
      }
      result.oauthClientId = formData.get("oauthClientId") as string;
      result.oauthClientSecret = formData.get("oauthClientSecret") as string;
      result.oauthScope = formData.get("oauthScope") as string;
    }

    this.onSubmit(result);
    this.close();
  }
}