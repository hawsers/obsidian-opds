import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon } from "obsidian";
import OPDSPlugin from "../main";
import { OPDSClient, createOPDSClient, isNavigationRel, isShelfRel, findNavigationLink, classifyCatalogKind } from "../opds-client";
import type { OPDSCatalog, OPDSLibrary, OPDSFeed, OPDSBook, OPDSEntry, OPDSLink, OPDSFacet, OPDSFacetGroup } from "../types/opds";

function showNoCover(container: HTMLElement): void {
  container.empty();
  container.addClass("opds-no-cover");
  setIcon(container, "book");
}

function loadCover(
  container: HTMLElement,
  href: string,
  alt: string,
  getClient: () => OPDSClient | null | Promise<OPDSClient | null>
): void {
  const img = container.createEl("img", { attr: { src: href, alt } });
  img.loading = "lazy";

  img.onerror = () => {
    if (img.dataset.authTried === "1") {
      showNoCover(container);
      return;
    }
    img.dataset.authTried = "1";

    Promise.resolve()
      .then(getClient)
      .then(client => {
        if (!client || !container.isConnected) {
          if (container.isConnected) showNoCover(container);
          return null;
        }
        return client.fetchCover(href);
      })
      .then(dataUrl => {
        if (dataUrl && container.isConnected) {
          img.src = dataUrl;
        } else if (!dataUrl && container.isConnected) {
          showNoCover(container);
        }
      })
      .catch(() => {
        if (container.isConnected) showNoCover(container);
      });
  };
}

export const LIBRARY_VIEW_TYPE = "opds-library-view";

export type SortField = "default" | "title" | "author" | "published" | "updated";
export type SortDir = "asc" | "desc";

export const SORT_FIELD_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "updated", label: "Updated" },
  { value: "published", label: "Published" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "default", label: "Default" }
];

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function primaryAuthor(entry: any): string {
  const name = entry?.author?.find((a: any) => a?.name)?.name;
  return name ? String(name) : "";
}

function publishedTime(entry: any): number {
  const raw = entry?.dcTerms?.issued || entry?.published;
  if (!raw) return Number.NaN;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? Number.NaN : t;
}

function updatedTime(entry: any): number {
  const raw = entry?.updated || entry?.dcTerms?.modified;
  if (!raw) return Number.NaN;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? Number.NaN : t;
}

function compareOptionalTime(a: number, b: number, newestFirst: boolean): number {
  const aOk = !Number.isNaN(a);
  const bOk = !Number.isNaN(b);
  if (aOk && bOk) return newestFirst ? b - a : a - b;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}

export function sortBooks<T>(entries: T[], field: SortField, dir: SortDir = "asc"): T[] {
  if (field === "default") return [...entries];

  const desc = dir === "desc";
  const items = [...entries];
  items.sort((a: any, b: any) => {
    switch (field) {
      case "title": {
        const cmp = compareStrings(String(a?.title || ""), String(b?.title || ""));
        return desc ? -cmp : cmp;
      }
      case "author": {
        const cmp =
          compareStrings(primaryAuthor(a), primaryAuthor(b)) ||
          compareStrings(String(a?.title || ""), String(b?.title || ""));
        return desc ? -cmp : cmp;
      }
      case "published":
        return compareOptionalTime(publishedTime(a), publishedTime(b), desc);
      case "updated":
        return compareOptionalTime(updatedTime(a), updatedTime(b), desc);
      default:
        return 0;
    }
  });
  return items;
}

export function matchesQuery(
  entry: any,
  query: string,
  caseSensitive = false
): boolean {
  const q = query.trim();
  if (!q) return true;

  const fields: string[] = [];
  if (entry?.title) fields.push(String(entry.title));
  if (Array.isArray(entry?.author)) {
    for (const a of entry.author) {
      if (a?.name) fields.push(String(a.name));
    }
  }
  if (Array.isArray(entry?.contributor)) {
    for (const c of entry.contributor) {
      if (c?.name) fields.push(String(c.name));
    }
  }
  if (entry?.summary) fields.push(String(entry.summary));
  if (entry?.content) fields.push(String(entry.content));
  if (entry?.dcTerms?.publisher) fields.push(String(entry.dcTerms.publisher));
  if (Array.isArray(entry?.category)) {
    for (const cat of entry.category) {
      if (cat?.term) fields.push(String(cat.term));
      if (cat?.label) fields.push(String(cat.label));
    }
  }
  if (Array.isArray(entry?.dcTerms?.subject)) {
    for (const s of entry.dcTerms.subject) {
      if (s) fields.push(String(s));
    }
  }

  const needle = caseSensitive ? q : q.toLowerCase();
  return fields.some(f => (caseSensitive ? f : f.toLowerCase()).includes(needle));
}

export function findCompleteEntryLink(entry: any): any | null {
  if (!entry || !Array.isArray(entry.link)) return null;
  return entry.link.find((l: any) => {
    if (!l) return false;
    const type = String(l.type || "").toLowerCase();
    const title = String(l.title || "").toLowerCase();
    const isEntryDoc =
      type.includes("type=entry") && type.includes("profile=opds-catalog");
    const isTitledComplete = title.includes("complete catalog entry");
    return l.rel === "alternate" && (isEntryDoc || isTitledComplete);
  }) || null;
}

export function isNavigationEntry(entry: OPDSEntry | any): boolean {
  if (!entry || !Array.isArray(entry.link)) return false;
  return entry.link.some((l: OPDSLink) => l && isNavigationRel(String(l.rel || "")));
}

export function isShelfEntry(entry: OPDSEntry | any): boolean {
  if (!entry || !Array.isArray(entry.link)) return false;
  return entry.link.some((l: OPDSLink) => l && isShelfRel(String(l.rel || "")));
}

export function getEffectiveTotal(
  serverTotal: number,
  loadedCount: number,
  hasActiveSearch: boolean
): number {
  if (hasActiveSearch) return loadedCount;
  if (serverTotal > 0) return serverTotal;
  return loadedCount;
}

export function getEffectiveTotalPages(effectiveTotal: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(effectiveTotal / pageSize));
}

export function needsServerFetch(
  targetPage: number,
  loadedCount: number,
  pageSize: number,
  hasNext: boolean
): boolean {
  if (targetPage < 1 || pageSize <= 0) return false;
  const needed = targetPage * pageSize;
  return loadedCount < needed && hasNext;
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

export function countItemsThatFit(
  itemCount: number,
  availableHeight: number,
  itemHeight: number
): number {
  if (itemCount <= 0) return 0;
  if (availableHeight <= 0 || itemHeight <= 0) return itemCount;
  return Math.max(1, Math.min(itemCount, Math.floor(availableHeight / itemHeight)));
}

export function formatFolderPath(parts: string[]): string {
  return parts.map(p => String(p ?? "").trim()).filter(Boolean).join(" / ");
}

/**
 * Which dropdown option should represent the current location.
 * The level-1 catalog (path segment 1, i.e. the stack entry right below the
 * root) wins over the current feed's URL: a subfolder may share its URL with
 * a differently-titled level-1 catalog, and the dropdown must stay aligned
 * with the browsed tree shown in the path row.
 */
export function selectCatalogDropdownId(
  catalogs: OPDSCatalog[],
  current: OPDSCatalog | null,
  stack: Array<{ catalog: OPDSCatalog }>
): string | undefined {
  const ids = new Set(catalogs.map(c => c.id));
  const level1 = stack[1]?.catalog;
  const chain = [
    ...(current ? [current] : []),
    ...[...stack].reverse().map(e => e.catalog)
  ];
  const candidates = level1 ? [level1, ...chain] : chain;
  return candidates.find(c => ids.has(c.id))?.id ?? catalogs[0]?.id;
}

const TYPE_FORMAT_LABELS: Array<[RegExp, string]> = [
  [/application\/epub\+zip|epub/i, "EPUB"],
  [/application\/pdf|pdf/i, "PDF"],
  [/application\/x-mobipocket|mobi/i, "MOBI"],
  [/kindle|azw/i, "AZW"],
  [/cbz/i, "CBZ"],
  [/cbr/i, "CBR"]
];

function labelFromExtension(value: string): string | null {
  const match = value.match(/\.([a-z0-9]{2,10})(?:\?|$)/i);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  const known = ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "cbr"];
  return known.includes(ext) ? ext.toUpperCase() : null;
}

export function formatDownloadLabel(link: any): string {
  const type = String(link?.type || "");
  for (const [pattern, label] of TYPE_FORMAT_LABELS) {
    if (pattern.test(type)) return label;
  }

  const title = String(link?.title || "").trim();
  if (!title) return "Download";

  const fromExt = labelFromExtension(title);
  if (fromExt) return fromExt;

  const isShortCleanTitle =
    title.length <= 20 &&
    !/%[0-9a-f]{2}/i.test(title) &&
    !/[\\/]/.test(title) &&
    !/\.(epub|pdf|mobi|azw3?|cbz|cbr|zip|kepub)/i.test(title);
  if (isShortCleanTitle) return title.toUpperCase();

  return "Download";
}

export class OPDSLibraryView extends ItemView {
  plugin: OPDSPlugin;
  client: OPDSClient | null = null;
  library: OPDSLibrary | null = null;
  currentFeed: OPDSFeed | null = null;
  currentCatalog: OPDSCatalog | null = null;
  navigationStack: Array<{ catalog: OPDSCatalog; feed: OPDSFeed }> = [];
  folderPath: string[] = [];
  detailEntry: OPDSEntry | null = null;
  private detailCompleteLoaded = false;
  private detailLoadToken = 0;
  currentPage = 1;
  private readonly listPageSizeFallback = 20;
  private fitPageSize: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  get pageSize(): number {
    return this.fitPageSize ?? this.listPageSizeFallback;
  }
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  searchQuery = "";
  searchCaseSensitive = false;
  sortField: SortField = "default";
  sortDir: SortDir = "desc";
  isSearching = false;
  private isLoadingPages = false;
  private isNavigating = false;
  private searchBoxEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private catalogFeedCache: { catalogId: string; feed: OPDSFeed } | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OPDSPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OPDS Library";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): void {
    await this.initializeClient();
    await this.loadLibrary();
    this.render();
    this.observeViewportResize();
  }

  private observeViewportResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.handleViewportResize(), 120);
    });
    this.resizeObserver.observe(this.containerEl);
  }

  private handleViewportResize(): void {
    if (this.detailEntry || this.isSearching) return;
    if (this.fitPageSize === null) return;
    this.fitPageSize = null;
    this.render();
  }

  private measureListFit(listEl: HTMLElement, candidateCount: number): number {
    if (candidateCount <= 1) return candidateCount;
    const available = listEl.clientHeight;
    if (available <= 0) return candidateCount;

    const children = Array.from(listEl.children) as HTMLElement[];
    if (children.length === 0) return candidateCount;

    const heights = children.map(el => el.getBoundingClientRect().height || el.offsetHeight);
    const avg = heights.reduce((sum, h) => sum + h, 0) / heights.length;
    if (avg <= 0) return candidateCount;

    // .opds-list-item has margin-bottom: 6px; .opds-book-list has 8px padding
    const pitch = avg + 6;
    const inner = Math.max(0, available - 16);
    const byHeight = Math.max(1, Math.floor(inner / pitch));

    // Grow when the viewport has room; never exceed the list page-size cap.
    return Math.max(1, Math.min(byHeight, this.listPageSizeFallback));
  }

  async initializeClient(): Promise<void> {
    const server = this.plugin.getActiveServer();
    if (!server) {
      this.showNoServerMessage();
      return;
    }

    this.client = this.plugin.createConfiguredClient(server);
    await this.plugin.configureClientAuth(this.client, server);
  }

  async loadLibrary(): Promise<void> {
    if (!this.client) return;

    try {
      this.library = await this.client.getLibrary();
      if (this.library.catalogs.length > 0) {
        this.currentCatalog = this.library.catalogs[0];
        this.folderPath = [this.currentCatalog.title];
        await this.loadCatalog(this.currentCatalog);
      }
    } catch (error) {
      console.error("Failed to load library:", error);
      new Notice("Failed to load library: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  async loadCatalog(catalog: OPDSCatalog): Promise<void> {
    if (!this.client) return;
    this.closeDetail(false);

    try {
      const feed = await this.client.getBooks(catalog.url);
      this.currentFeed = feed;
      this.currentCatalog = catalog;
      this.currentPage = 1;
      this.fitPageSize = null;
      this.render();
    } catch (error) {
      console.error("Failed to load catalog:", error);
      new Notice("Failed to load catalog: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async ensureCatalogFeed(): Promise<OPDSFeed | null> {
    if (!this.client || !this.currentCatalog) return null;
    if (this.catalogFeedCache && this.catalogFeedCache.catalogId === this.currentCatalog.id) {
      this.currentFeed = this.catalogFeedCache.feed;
      return this.catalogFeedCache.feed;
    }
    try {
      const feed = await this.client.getBooks(this.currentCatalog.url);
      this.catalogFeedCache = { catalogId: this.currentCatalog.id, feed };
      this.currentFeed = feed;
      return feed;
    } catch (error) {
      console.error("Failed to load catalog:", error);
      new Notice("Failed to load catalog: " + (error instanceof Error ? error.message : String(error)));
      return null;
    }
  }

  private async runSearch(): Promise<void> {
    if (!this.client) return;
    this.closeDetail(false);

    const query = this.searchQuery.trim();
    if (!query) {
      this.setSearchLoading(false);
      if (this.currentCatalog) await this.loadCatalog(this.currentCatalog);
      return;
    }

    this.setSearchLoading(true);
    try {
      const searchUrl = this.currentCatalog?.url;
      let served = false;

      if (searchUrl) {
        try {
          const feed = await this.client.searchBooks(query, searchUrl);
          this.currentFeed = feed;
          this.currentPage = 1;
          this.fitPageSize = null;
          served = true;
        } catch (error) {
          console.error("Search failed:", error);
          if (!this.searchCaseSensitive) {
            new Notice("Search failed: " + (error instanceof Error ? error.message : String(error)));
          }
        }
      }

      if (!served) {
        const feed = await this.ensureCatalogFeed();
        if (feed) {
          this.currentFeed = feed;
          this.currentPage = 1;
          this.fitPageSize = null;
        }
      }
    } finally {
      this.setSearchLoading(false);
      this.render();
    }
  }

  private setSearchLoading(loading: boolean): void {
    this.isSearching = loading;
    if (loading) {
      this.showContentLoading();
    }
  }

  private showContentLoading(): void {
    const root = this.contentEl || this.containerEl;
    root.empty();
    const loading = root.createDiv({ cls: "opds-loading" });
    loading.createDiv({ cls: "opds-spinner" });
    loading.createEl("div", { text: "Searching…", cls: "opds-loading-text" });
  }

  async navigateToCatalog(catalog: OPDSCatalog): Promise<void> {
    if (this.isNavigating) return;
    if (this.currentCatalog && this.currentCatalog.url === catalog.url) return;

    this.isNavigating = true;
    try {
      this.closeDetail(false);
      const previousPath = [...this.folderPath];
      const prevCatalog = this.currentCatalog;
      const prevFeed = this.currentFeed;
      const pushed = !!(prevCatalog && prevFeed);
      if (prevCatalog && prevFeed) {
        this.navigationStack.push({ catalog: prevCatalog, feed: prevFeed });
        this.folderPath.push(catalog.title);
      } else {
        this.folderPath = catalog.title ? [catalog.title] : [];
      }
      await this.loadCatalog(catalog);
      if (this.currentCatalog !== catalog) {
        // Load failed: roll back so the path/back state matches what is on screen.
        if (pushed) this.navigationStack.pop();
        this.folderPath = previousPath;
      }
    } finally {
      this.isNavigating = false;
    }
  }

  async navigateToRootCatalog(catalog: OPDSCatalog): Promise<void> {
    if (this.isNavigating) return;
    if (this.currentCatalog && this.currentCatalog.url === catalog.url) return;

    this.isNavigating = true;
    try {
      this.closeDetail(false);
      const previousStack = [...this.navigationStack];
      const previousPath = [...this.folderPath];
      const rootEntry = previousStack[0];
      if (rootEntry && rootEntry.catalog.url === catalog.url) {
        // Jumping to the server root itself: clear all context.
        this.navigationStack = [];
        this.folderPath = catalog.title ? [catalog.title] : [];
      } else if (rootEntry) {
        // Jumping to a level-1 catalog: keep the root entry so the header
        // stays in browsing mode (path row + catalog dropdown) and Back
        // returns to the server root.
        this.navigationStack = [rootEntry];
        const rootTitle = rootEntry.catalog.title;
        this.folderPath = rootTitle && catalog.title ? [rootTitle, catalog.title] : [catalog.title || rootTitle];
      } else {
        this.navigationStack = [];
        this.folderPath = catalog.title ? [catalog.title] : [];
      }
      this.searchQuery = "";
      this.catalogFeedCache = null;
      await this.loadCatalog(catalog);
      if (this.currentCatalog !== catalog) {
        // Load failed: restore the location we jumped from.
        this.navigationStack = previousStack;
        this.folderPath = previousPath;
      }
    } finally {
      this.isNavigating = false;
    }
  }

  async activateServer(index: number): Promise<void> {
    const servers = this.plugin.settings.servers;
    if (index < 0 || index >= servers.length) return;
    if (index === this.plugin.settings.activeServerIndex) return;

    this.plugin.settings.activeServerIndex = index;
    await this.plugin.saveSettings();

    this.navigationStack = [];
    this.folderPath = [];
    this.closeDetail(false);
    this.catalogFeedCache = null;
    this.library = null;
    this.currentCatalog = null;
    this.currentFeed = null;
    this.searchQuery = "";
    this.currentPage = 1;
    this.fitPageSize = null;

    try {
      await this.initializeClient();
      if (this.client) {
        await this.loadLibrary();
      }
    } catch (error) {
      new Notice("Failed to switch feed: " + (error instanceof Error ? error.message : String(error)));
    }
    this.render();
  }

  async goBack(): Promise<void> {
    if (this.detailEntry) {
      this.closeDetail();
      return;
    }
    if (this.navigationStack.length > 0) {
      const previous = this.navigationStack.pop()!;
      this.currentCatalog = previous.catalog;
      this.currentFeed = previous.feed;
      if (this.folderPath.length > 1) this.folderPath.pop();
      this.currentPage = 1;
      this.fitPageSize = null;
      this.render();
    }
  }

  async goHome(): Promise<void> {
    this.closeDetail(false);
    const root = this.navigationStack[0];
    this.navigationStack = [];
    const target = root?.catalog ?? this.currentCatalog;
    this.folderPath = target ? [target.title] : [];
    this.currentPage = 1;
    this.fitPageSize = null;
    this.searchQuery = "";
    this.catalogFeedCache = null;
    if (root) {
      this.currentCatalog = root.catalog;
      this.currentFeed = root.feed;
    }
    this.render();
    if (target) {
      await this.loadCatalog(target);
    }
  }

  openDetail(entry: OPDSEntry): void {
    this.detailEntry = entry;
    this.detailCompleteLoaded = false;
    this.detailLoadToken++;
    this.render();
    void this.loadCompleteDetailEntry();
  }

  closeDetail(rerender = true): void {
    if (!this.detailEntry && !rerender) return;
    const wasOpen = !!this.detailEntry;
    this.detailEntry = null;
    this.detailCompleteLoaded = false;
    this.detailLoadToken++;
    if (rerender && wasOpen) this.render();
  }

  private async loadCompleteDetailEntry(): Promise<void> {
    const entry = this.detailEntry;
    if (!entry) return;

    const completeLink = findCompleteEntryLink(entry);
    if (!completeLink?.href) return;

    const server = this.plugin.getActiveServer();
    if (!server) return;

    const token = this.detailLoadToken;
    try {
      const client = this.plugin.createConfiguredClient(server);
      await this.plugin.configureClientAuth(client, server);
      const feed = await client.getCatalog(completeLink.href);
      const completeEntry = feed.entry[0];
      if (!completeEntry || token !== this.detailLoadToken || !this.detailEntry) return;

      this.detailEntry = mergeCatalogEntries(this.detailEntry, completeEntry);
      this.detailCompleteLoaded = true;
      this.render();
    } catch (error) {
      console.warn("Failed to load complete catalog entry:", error);
    }
  }

  private renderBookDetail(root: HTMLElement, entry: OPDSEntry): void {
    const contentEl = root;
    contentEl.addClass("opds-book-detail");

    const coverLink = entry.link.find((l: any) =>
      l.rel.includes("image") || l.type?.startsWith("image/")
    );
    const downloadLinks = entry.link.filter((l: any) =>
      l.rel === "http://opds-spec.org/acquisition" ||
      l.rel === "http://opds-spec.org/acquisition/open-access" ||
      l.rel === "http://opds-spec.org/acquisition/borrow" ||
      l.rel === "http://opds-spec.org/acquisition/buy" ||
      l.rel === "http://opds-spec.org/acquisition/sample" ||
      (l.rel === "alternate" && l.type && /application\/(epub|pdf|mobi|x-mobipocket)/.test(l.type))
    );
    const authors = entry.author?.map((a: any) => a.name).filter(Boolean) || [];
    const contributors = entry.contributor?.map((c: any) => c.name).filter(Boolean) || [];
    const subjects = entry.category?.map((c: any) => c.term || c.label).filter(Boolean) || [];
    const dcTerms = entry.dcTerms || {};
    const formats = downloadLinks
      .map((l: any) => (l.title || l.type || "").split("/").pop() || "")
      .filter(Boolean)
      .map((f: string) => f.toUpperCase())
      .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i);

    const title = entry.title || "Untitled";
    const description = entry.summary || entry.content || dcTerms.description;

    if (coverLink) {
      const cover = contentEl.createDiv({ cls: "opds-modal-cover" });
      loadCover(cover, coverLink.href, entry.title, () => this.client);
    }

    contentEl.createEl("h2", { text: title, cls: "opds-modal-title" });

    if (authors.length > 0) {
      contentEl.createEl("p", { text: "by " + authors.join(", "), cls: "opds-modal-authors" });
    }

    const details = contentEl.createDiv({ cls: "opds-modal-details" });

    const addDetail = (label: string, value: string | undefined | null) => {
      if (!value) return;
      const row = details.createDiv({ cls: "opds-modal-detail-row" });
      row.createEl("span", { text: label, cls: "opds-modal-detail-label" });
      row.createEl("span", { text: value, cls: "opds-modal-detail-value" });
    };

    addDetail("Identifier", entry.id);
    if (Array.isArray(dcTerms.identifier) && dcTerms.identifier.length > 0) {
      addDetail("Identifiers", dcTerms.identifier.join(", "));
    }
    if (contributors.length > 0) addDetail("Contributors", contributors.join(", "));
    if (subjects.length > 0) addDetail("Subjects", subjects.join(", "));
    if (Array.isArray(dcTerms.subject) && dcTerms.subject.length > 0) {
      addDetail("Subject terms", dcTerms.subject.join(", "));
    }
    addDetail("Publisher", dcTerms.publisher);
    const publishedDate = dcTerms.issued || entry.published;
    if (publishedDate) {
      const year = new Date(publishedDate).getFullYear();
      addDetail("Published", Number.isNaN(year) ? String(publishedDate) : `${publishedDate} (${year})`);
    }
    if (entry.updated) addDetail("Updated", entry.updated);
    if (dcTerms.modified) addDetail("Modified", dcTerms.modified);
    addDetail("Language", dcTerms.language);
    addDetail("Type", dcTerms.type);
    addDetail("Format", dcTerms.format);
    addDetail("Relation", dcTerms.relation);
    addDetail("Coverage", dcTerms.coverage);
    addDetail("Rights", entry.rights || dcTerms.rights);
    if (formats.length > 0) addDetail("Available formats", formats.join(", "));

    if (this.detailCompleteLoaded) {
      details.createEl("span", { text: "Complete entry", cls: "opds-complete-badge" });
    }

    if (description) {
      const desc = contentEl.createDiv({ cls: "opds-modal-description" });
      desc.createEl("h3", { text: "Description" });
      desc.createEl("p", { text: description });
    }

    if (entry.content && entry.summary && entry.content !== entry.summary) {
      const content = contentEl.createDiv({ cls: "opds-modal-content" });
      content.createEl("h3", { text: "Content" });
      content.createEl("p", { text: entry.content });
    } else if (!description && entry.content) {
      const content = contentEl.createDiv({ cls: "opds-modal-content" });
      content.createEl("h3", { text: "Content" });
      content.createEl("p", { text: entry.content });
    }
  }

  render(): void {
    const { containerEl } = this;
    const hadSearchFocus = this.searchBoxEl?.querySelector(".opds-search-input") === document.activeElement;
    const selectionStart = (document.activeElement as HTMLInputElement | null)?.selectionStart;

    containerEl.empty();
    containerEl.addClass("opds-library-view");
    this.searchBoxEl = null;
    this.contentEl = null;

    if (!this.client) {
      this.showNoServerMessage();
      return;
    }

    this.renderHeader();
    this.contentEl = containerEl.createDiv({ cls: "opds-content" });
    if (this.isSearching) {
      this.showContentLoading();
    } else if (this.detailEntry) {
      this.renderBookDetail(this.contentEl, this.detailEntry);
    } else {
      this.renderContent();
    }

    if (hadSearchFocus) {
      const input = this.searchBoxEl?.querySelector(".opds-search-input") as HTMLInputElement | null;
      if (input) {
        input.focus();
        if (typeof selectionStart === "number") {
          try {
            input.setSelectionRange(selectionStart, selectionStart);
          } catch {
            // search inputs may not support setSelectionRange in all environments
          }
        }
      }
    }
  }

  private renderHeader(): void {
    const { containerEl } = this;
    const header = containerEl.createDiv({ cls: "opds-header" });

    const titleSection = header.createDiv({ cls: "opds-title-section" });
    const inDetail = !!this.detailEntry;
    titleSection.createEl("h2", {
      text: inDetail ? "Book details" : this.library?.title || "OPDS Library"
    });

    const navSection = header.createDiv({ cls: "opds-nav-section" });
    const atRoot = this.navigationStack.length === 0;

    const homeBtn = navSection.createEl("button", {
      cls: "opds-nav-btn opds-home-btn",
      attr: { "aria-label": "Server selection", title: "Server selection" }
    });
    setIcon(homeBtn, "home");
    homeBtn.onclick = () => {
      void this.goHome();
    };

    if (inDetail) return;

    if (atRoot) {
      const servers = this.plugin.settings.servers;
      if (servers.length > 1) {
        const feedSelect = navSection.createEl("select", {
          cls: "opds-catalog-select opds-feed-select",
          attr: { "aria-label": "Active feed", title: "Active feed" }
        });
        for (let i = 0; i < servers.length; i++) {
          const server = servers[i];
          const option = feedSelect.createEl("option", {
            value: String(i),
            text: server.name || server.url
          });
          if (i === this.plugin.settings.activeServerIndex) option.selected = true;
        }
        feedSelect.onchange = (e) => {
          const index = Number((e.target as HTMLSelectElement).value);
          void this.activateServer(index);
        };
      }
    } else {
      if (this.library && this.library.catalogs.length > 1) {
        const catalogSelect = navSection.createEl("select", { cls: "opds-catalog-select" });
        const selectedCatalogId = selectCatalogDropdownId(
          this.library.catalogs,
          this.currentCatalog,
          this.navigationStack
        );
        for (const catalog of this.library.catalogs) {
          const option = catalogSelect.createEl("option", { value: catalog.id, text: catalog.title });
          if (catalog.id === selectedCatalogId) option.selected = true;
        }
        catalogSelect.onchange = (e) => {
          const selectedId = (e.target as HTMLSelectElement).value;
          const catalog = this.library!.catalogs.find(c => c.id === selectedId);
          if (catalog) void this.navigateToRootCatalog(catalog);
        };
      }

      const refreshBtn = navSection.createEl("button", {
        cls: "opds-nav-btn",
        attr: { "aria-label": "Refresh feed" }
      });
      setIcon(refreshBtn, "refresh-cw");
      refreshBtn.onclick = () => this.refreshCurrentFeed();

      const rightGroup = navSection.createDiv({ cls: "opds-nav-right" });
      const sortWrap = rightGroup.createDiv({ cls: "opds-sort-wrap" });

      const sortSelect = sortWrap.createEl("select", {
        cls: "opds-sort-select",
        attr: { "aria-label": "Sort field", title: "Sort by" }
      });
      for (const opt of SORT_FIELD_OPTIONS) {
        const option = sortSelect.createEl("option", { value: opt.value, text: opt.label });
        if (opt.value === this.sortField) option.selected = true;
      }
      sortSelect.onchange = (e) => {
        this.sortField = (e.target as HTMLSelectElement).value as SortField;
        this.currentPage = 1;
        this.fitPageSize = null;
        this.render();
      };

      const dirBtn = sortWrap.createEl("button", {
        cls: "opds-nav-btn opds-sort-dir",
        attr: {
          "aria-label": this.sortDir === "desc" ? "Sort ascending" : "Sort descending",
          title: this.sortDir === "desc" ? "Sort ascending" : "Sort descending"
        }
      });
      setIcon(dirBtn, this.sortDir === "desc" ? "arrow-down" : "arrow-up");
      dirBtn.disabled = this.sortField === "default";
      dirBtn.onclick = () => {
        if (this.sortField === "default") return;
        this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
        this.currentPage = 1;
        this.fitPageSize = null;
        this.render();
      };
    }

    const searchBox = header.createDiv({ cls: "opds-search-box" });
    this.searchBoxEl = searchBox;
    const searchInput = searchBox.createEl("input", {
      type: "search",
      placeholder: "Search books...",
      cls: "opds-search-input"
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      const hasQuery = searchInput.value.trim().length > 0;
      if (hasQuery) {
        this.setSearchLoading(true);
        this.searchDebounceTimer = setTimeout(() => {
          this.searchQuery = searchInput.value;
          this.runSearch();
        }, 300);
      } else {
        this.searchQuery = "";
        this.setSearchLoading(false);
        this.runSearch();
      }
    });

    const caseLabel = searchBox.createEl("label", {
      cls: "opds-search-option" + (this.searchCaseSensitive ? " active" : ""),
      attr: { title: "Match case", "aria-label": "Match case" }
    });
    const caseCheckbox = caseLabel.createEl("input", { type: "checkbox" });
    caseCheckbox.checked = this.searchCaseSensitive;
    caseLabel.createEl("span", { text: "Aa" });
    caseCheckbox.addEventListener("change", () => {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
      }
      this.searchCaseSensitive = caseCheckbox.checked;
      caseLabel.toggleClass("active", this.searchCaseSensitive);
      this.searchQuery = searchInput.value;
      this.runSearch();
    });

    const pathText = formatFolderPath(this.folderPath);
    if (!atRoot && pathText) {
      const pathRow = header.createDiv({ cls: "opds-path-row" });
      const backBtn = pathRow.createEl("button", {
        cls: "opds-nav-btn opds-path-up",
        attr: { "aria-label": "Go up one level", title: "Go up one level" }
      });
      setIcon(backBtn, "arrow-up");
      backBtn.onclick = () => {
        void this.goBack();
      };
      pathRow.createEl("span", { text: pathText, cls: "opds-path-text" });
    }
  }

  private renderContent(): void {
    const root = this.contentEl || this.containerEl;
    const containerEl = root;

    if (!this.currentFeed) {
      containerEl.createDiv({ cls: "opds-empty", text: "No books found" });
      return;
    }

    this.renderFacets(containerEl, this.currentFeed.facetGroup);

    if (this.currentFeed.entry.length === 0) {
      containerEl.createDiv({ cls: "opds-empty", text: "No books found" });
      return;
    }

    const entries = this.currentFeed.entry;

    const navigationEntries = entries.filter(isNavigationEntry);
    const bookEntries = entries.filter(e => !isNavigationEntry(e));

    if (navigationEntries.length > 0) {
      const navSection = containerEl.createDiv({ cls: "opds-nav-section-list" });
      for (const entry of navigationEntries) {
        this.renderNavigationEntry(navSection, entry);
      }
    }

    const filteredBooks = sortBooks(
      bookEntries.filter(e =>
        matchesQuery(e, this.searchQuery, this.searchCaseSensitive)
      ),
      this.sortField,
      this.sortDir
    );
    const loadedCount = filteredBooks.length;
    const hasActiveSearch = this.searchQuery.trim().length > 0;
    const serverTotal = this.currentFeed.totalResults || 0;
    const effectiveTotal = getEffectiveTotal(serverTotal, loadedCount, hasActiveSearch);

    if (loadedCount === 0) {
      const query = this.searchQuery.trim();
      if (query || navigationEntries.length === 0) {
        containerEl.createDiv({
          cls: "opds-empty",
          text: query
            ? this.searchCaseSensitive
              ? `No books match "${query}" (case-sensitive)`
              : `No books match "${query}"`
            : "No books found"
        });
      }
      return;
    }

    let pageSize = this.pageSize;
    let totalPages = getEffectiveTotalPages(effectiveTotal, pageSize);
    this.currentPage = clampPage(this.currentPage, totalPages);
    let startIdx = (this.currentPage - 1) * pageSize;
    let paginatedBooks = filteredBooks.slice(startIdx, startIdx + pageSize);

    const paginationHost = containerEl.createDiv({ cls: "opds-pagination-host" });

    const itemsContainer = containerEl.createDiv({ cls: "opds-book-list" });
    const paintItems = (books: any[]) => {
      itemsContainer.empty();
      for (const entry of books) {
        this.renderBookListEntry(itemsContainer, entry);
      }
    };

    paintItems(paginatedBooks);

    // Measure only when fit is unknown (catalog load / resize). Re-measuring on
    // every page change can grow pageSize, collapse totalPages to 1, and hide
    // pagination while jumping back to page 1.
    if (this.fitPageSize === null) {
      const fitted = this.measureListFit(itemsContainer, paginatedBooks.length);
      this.fitPageSize = fitted;
      if (fitted !== pageSize) {
        pageSize = fitted;
        totalPages = getEffectiveTotalPages(effectiveTotal, pageSize);
        this.currentPage = clampPage(this.currentPage, totalPages);
        startIdx = (this.currentPage - 1) * pageSize;
        paginatedBooks = filteredBooks.slice(startIdx, startIdx + pageSize);
        paintItems(paginatedBooks);
      }
    }

    const infoBar = containerEl.createDiv({ cls: "opds-info-bar" });
    const query = this.searchQuery.trim();
    const renderInfo = (pages: number, size: number, shown: number) => {
      infoBar.empty();
      if (query) {
        infoBar.createEl("span", {
          text: loadedCount + " matching book" + (loadedCount === 1 ? "" : "s")
        });
      } else if (serverTotal > 0 && serverTotal > loadedCount) {
        infoBar.createEl("span", {
          text: "Showing " + loadedCount + " of " + serverTotal + " books"
        });
      } else if (serverTotal > 0) {
        infoBar.createEl("span", {
          text: serverTotal + " book" + (serverTotal === 1 ? "" : "s")
        });
      } else {
        infoBar.createEl("span", {
          text: loadedCount + " book" + (loadedCount === 1 ? "" : "s")
        });
      }
      if (pages > 1) {
        infoBar.createEl("span", { text: "Page " + Math.min(this.currentPage, pages) + " of " + pages });
      } else if (size > 0 && shown < loadedCount) {
        infoBar.createEl("span", { text: "Showing " + shown + " at a time" });
      }
    };
    renderInfo(totalPages, pageSize, paginatedBooks.length);

    if (totalPages > 1) {
      this.renderPagination(paginationHost, totalPages, loadedCount);
    }
  }

  private renderFacets(container: HTMLElement, facetGroups?: OPDSFacetGroup[]): void {
    if (!facetGroups || facetGroups.length === 0) return;

    const bar = container.createDiv({ cls: "opds-facet-bar" });
    for (const group of facetGroups) {
      if (!group.facet || group.facet.length === 0) continue;
      const groupEl = bar.createDiv({ cls: "opds-facet-group" });
      if (group.title) {
        groupEl.createEl("span", { text: group.title, cls: "opds-facet-group-title" });
      }
      const chips = groupEl.createDiv({ cls: "opds-facet-chips" });
      for (const facet of group.facet) {
        const label = facet.title || facet.value || "Facet";
        const chip = chips.createEl("button", {
          text: label,
          cls: "opds-facet-chip" + (facet.active ? " active" : "")
        });
        if (facet.count > 0) {
          chip.createEl("span", { text: String(facet.count), cls: "opds-facet-count" });
        }
        chip.onclick = () => this.navigateToFacet(facet);
      }
    }
  }

  async navigateToFacet(facet: OPDSFacet): Promise<void> {
    if (!facet.href || !this.client) return;
    if (this.isNavigating) return;

    this.isNavigating = true;
    try {
      this.closeDetail(false);
      if (this.currentCatalog && this.currentFeed) {
        this.navigationStack.push({ catalog: this.currentCatalog, feed: this.currentFeed });
        this.folderPath.push(facet.title || facet.value || "Facet");
      }
      try {
        const feed = await this.client.getBooks(facet.href);
        this.currentFeed = feed;
        this.currentPage = 1;
        this.render();
      } catch (error) {
        console.error("Failed to navigate to facet:", error);
        new Notice("Failed to apply filter: " + (error instanceof Error ? error.message : String(error)));
        await this.goBack();
      }
    } finally {
      this.isNavigating = false;
    }
  }

  async refreshCurrentFeed(): Promise<void> {
    if (!this.client || !this.currentCatalog) return;
    this.catalogFeedCache = null;
    await this.loadCatalog(this.currentCatalog);
  }

  private renderNavigationEntry(container: HTMLElement, entry: any): void {
    const item = container.createDiv({ cls: "opds-nav-entry" });

    const shelf = isShelfEntry(entry);
    const icon = item.createDiv({ cls: "opds-nav-icon" + (shelf ? " opds-shelf-icon" : "") });
    setIcon(icon, shelf ? "library" : "folder-open");

    const info = item.createDiv({ cls: "opds-nav-info" });
    info.createEl("div", { text: entry.title, cls: "opds-nav-title" });
    if (shelf) {
      info.createEl("span", { text: "Shelf", cls: "opds-shelf-badge" });
    }
    if (entry.summary) {
      info.createEl("div", { text: entry.summary, cls: "opds-nav-summary" });
    }

    setIcon(item.createDiv({ cls: "opds-nav-arrow" }), "chevron-right");

    item.onclick = () => {
      const catalogLink = findNavigationLink(entry.link || []);
      if (catalogLink) {
        this.navigateToCatalog({
          id: catalogLink.href,
          title: entry.title,
          url: catalogLink.href,
          type: "navigation",
          kind: classifyCatalogKind(catalogLink.rel)
        });
      }
    };
  }

  private renderBookListEntry(container: HTMLElement, entry: any): void {
    const item = container.createDiv({ cls: "opds-book-list-item" });

    const coverLink = entry.link.find((l: any) =>
      l.rel.includes("image") || l.type?.startsWith("image/")
    );

    if (coverLink) {
      const cover = item.createDiv({ cls: "opds-list-cover" });
      loadCover(cover, coverLink.href, entry.title, () => this.client);
    } else {
      const cover = item.createDiv({ cls: "opds-list-cover opds-no-cover" });
      setIcon(cover, "book");
    }

    const info = item.createDiv({ cls: "opds-list-info" });
    info.createEl("div", { text: entry.title, cls: "opds-list-title" });

    const authors = entry.author?.map((a: any) => a.name).filter(Boolean).join(", ");
    if (authors) {
      info.createEl("div", { text: authors, cls: "opds-list-authors" });
    }

    const meta = info.createDiv({ cls: "opds-list-meta" });
    if (entry.dcTerms?.publisher) {
      meta.createEl("span", { text: entry.dcTerms.publisher, cls: "opds-list-meta-item" });
    }
    if (entry.dcTerms?.issued) {
      meta.createEl("span", {
        text: new Date(entry.dcTerms.issued).getFullYear().toString(),
        cls: "opds-list-meta-item"
      });
    }
    if (entry.dcTerms?.language) {
      meta.createEl("span", { text: entry.dcTerms.language, cls: "opds-list-meta-item" });
    }

    const subjects = (entry.category || [])
      .map((c: any) => c.term || c.label)
      .filter(Boolean)
      .slice(0, 4);
    if (subjects.length > 0) {
      meta.createEl("span", { text: subjects.join(", "), cls: "opds-list-meta-item" });
    }

    const formats = this.getAcquisitionLinks(entry)
      .map(l => this.formatLabel(l))
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 3);
    if (formats.length > 0) {
      meta.createEl("span", { text: formats.join(" · "), cls: "opds-list-meta-item opds-list-formats" });
    }

    const sizes = this.getAcquisitionLinks(entry)
      .map(l => (l.length ? this.formatSize(l.length) : null))
      .filter(Boolean)
      .slice(0, 1);
    if (sizes.length > 0) {
      meta.createEl("span", { text: sizes[0], cls: "opds-list-meta-item" });
    }

    const description = entry.summary || entry.content;
    if (description) {
      const text = String(description).replace(/\s+/g, " ").trim();
      if (text) {
        info.createEl("div", {
          text: text.length > 180 ? text.slice(0, 180).trimEnd() + "…" : text,
          cls: "opds-list-description"
        });
      }
    }

    const action = item.createDiv({ cls: "opds-list-action" });
    const dlLinks = this.getAcquisitionLinks(entry);
    if (dlLinks.length > 0) {
      const preferred = this.pickDownloadLink(dlLinks);
      const btn = action.createEl("button", {
        cls: "opds-list-download-btn",
        attr: { "aria-label": "Download " + entry.title }
      });
      setIcon(btn, "download");
      btn.createEl("span", { text: this.formatLabel(preferred) });
      btn.onclick = (e) => {
        e.stopPropagation();
        this.downloadEntry(entry, preferred);
      };
    }

    item.onclick = () => {
      this.openDetail(entry);
    };
  }

  private getAcquisitionLinks(entry: any): any[] {
    const acqRels = [
      "http://opds-spec.org/acquisition",
      "http://opds-spec.org/acquisition/open-access",
      "http://opds-spec.org/acquisition/borrow",
      "http://opds-spec.org/acquisition/buy",
      "http://opds-spec.org/acquisition/sample"
    ];
    return (entry.link || []).filter(
      (l: any) =>
        acqRels.includes(l.rel) ||
        (l.rel === "alternate" && l.type && /application\/(epub|pdf|mobi|x-mobipocket)/.test(l.type))
    );
  }

  private formatLabel(link: any): string {
    return formatDownloadLabel(link);
  }

  private formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }

  private pickDownloadLink(links: any[]): any {
    const preferred = this.plugin.settings.preferredFormat;
    if (preferred && preferred !== "any") {
      const match = links.find(l => {
        const t = String(l.type || "").toLowerCase();
        const title = String(l.title || "").toLowerCase();
        return t.includes(preferred) || title.includes(preferred);
      });
      if (match) return match;
    }
    return links[0];
  }

  async downloadEntry(entry: any, link: any): Promise<void> {
    try {
      if (!this.client) {
        new Notice("No OPDS server configured");
        return;
      }
      new Notice("Downloading " + (entry.title || "book") + "…");
      const arrayBuffer = await this.client.downloadBook(link.href);

      const type = String(link.type || "");
      const ext =
        type.includes("epub") || (link.title || "").toLowerCase().includes("epub") ? "epub" :
        type.includes("pdf") || (link.title || "").toLowerCase().includes("pdf") ? "pdf" :
        type.includes("mobi") ? "mobi" :
        this.plugin.settings.preferredFormat !== "any" ? this.plugin.settings.preferredFormat : "epub";

      const fileName =
        String(entry.title || "book").replace(/[<>:"/\\|?*]/g, "_").substring(0, 200) + "." + ext;
      const dir = this.plugin.settings.downloadPath;
      const filePath = dir + "/" + fileName;

      if (!this.plugin.app.vault.getAbstractFileByPath(dir)) {
        await this.plugin.app.vault.createFolder(dir);
      }

      const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        await this.plugin.app.vault.modifyBinary(existing, arrayBuffer);
      } else {
        await this.plugin.app.vault.createBinary(filePath, arrayBuffer);
      }
      new Notice("Downloaded: " + fileName);
    } catch (error) {
      new Notice("Download failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  private renderPagination(container: HTMLElement, totalPages: number, loadedCount: number): void {
    const pagination = container.createDiv({ cls: "opds-pagination" });
    const hasNext = this.currentFeed?.link.some(l => l.rel === "next") ?? false;
    const isPageAvailable = (page: number): boolean => {
      if (page < 1 || page > totalPages) return false;
      if (page <= Math.max(1, Math.ceil(loadedCount / this.pageSize))) return true;
      return needsServerFetch(page, loadedCount, this.pageSize, hasNext);
    };

    const prevBtn = pagination.createEl("button", {
      text: "Prev",
      cls: "opds-page-btn",
      attr: { "aria-label": "Previous page" }
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.disabled = this.currentPage <= 1;
    prevBtn.onclick = () => {
      if (this.currentPage > 1) {
        void this.goToPage(this.currentPage - 1);
      }
    };

    const maxVisible = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      const firstBtn = pagination.createEl("button", { text: "1", cls: "opds-page-btn" });
      firstBtn.disabled = !isPageAvailable(1);
      firstBtn.onclick = () => {
        void this.goToPage(1);
      };
      if (startPage > 2) {
        pagination.createEl("span", { text: "...", cls: "opds-page-ellipsis" });
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = pagination.createEl("button", {
        text: i.toString(),
        cls: "opds-page-btn" + (i === this.currentPage ? " active" : "")
      });
      pageBtn.disabled = !isPageAvailable(i);
      const page = i;
      pageBtn.onclick = () => {
        void this.goToPage(page);
      };
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pagination.createEl("span", { text: "...", cls: "opds-page-ellipsis" });
      }
      const lastBtn = pagination.createEl("button", {
        text: totalPages.toString(),
        cls: "opds-page-btn"
      });
      lastBtn.disabled = !isPageAvailable(totalPages);
      lastBtn.onclick = () => {
        void this.goToPage(totalPages);
      };
    }

    const nextBtn = pagination.createEl("button", {
      text: "Next",
      cls: "opds-page-btn",
      attr: { "aria-label": "Next page" }
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = this.currentPage >= totalPages || !isPageAvailable(this.currentPage + 1);
    nextBtn.onclick = () => {
      if (this.currentPage < totalPages) {
        void this.goToPage(this.currentPage + 1);
      }
    };
  }

  async goToPage(page: number): Promise<void> {
    if (!this.client || !this.currentFeed) return;

    const hasActiveSearch = this.searchQuery.trim().length > 0;
    const serverTotal = this.currentFeed.totalResults || 0;
    const loadedCount = this.currentFeed.entry.filter(e => !isNavigationEntry(e)).length;
    const effectiveTotal = getEffectiveTotal(serverTotal, loadedCount, hasActiveSearch);
    const totalPages = getEffectiveTotalPages(effectiveTotal, this.pageSize);
    const target = clampPage(page, totalPages);

    const hasNext = this.currentFeed.link.some(l => l.rel === "next");
    if (needsServerFetch(target, loadedCount, this.pageSize, hasNext)) {
      const ok = await this.ensurePagesLoaded(target);
      if (!ok) return;
    }

    this.currentPage = target;
    this.render();
  }

  private async ensurePagesLoaded(targetPage: number): Promise<boolean> {
    if (!this.client || !this.currentFeed) return false;
    if (this.isLoadingPages) return false;

    this.isLoadingPages = true;
    this.setSearchLoading(true);
    try {
      let guard = 0;
      while (guard++ < 50) {
        const loadedCount = this.currentFeed.entry.filter(e => !isNavigationEntry(e)).length;
        const hasNext = this.currentFeed.link.some(l => l.rel === "next");
        if (!needsServerFetch(targetPage, loadedCount, this.pageSize, hasNext)) {
          return true;
        }
        const nextLink = this.currentFeed.link.find(l => l.rel === "next");
        if (!nextLink) return loadedCount >= targetPage * this.pageSize;

        const feed = await this.client.getBooks(nextLink.href);
        this.currentFeed.entry.push(...feed.entry);
        this.currentFeed.link = feed.link;
        if (feed.totalResults && feed.totalResults > 0) {
          this.currentFeed.totalResults = feed.totalResults;
        }
      }
      return true;
    } catch (error) {
      console.error("Failed to load more pages:", error);
      new Notice("Failed to load more results: " + (error instanceof Error ? error.message : String(error)));
      return false;
    } finally {
      this.isLoadingPages = false;
      this.setSearchLoading(false);
    }
  }

  async onClose(): Promise<void> {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private showNoServerMessage(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("opds-library-view");

    const msg = containerEl.createDiv({ cls: "opds-no-server" });
    msg.createEl("h3", { text: "No OPDS Server Configured" });
    msg.createEl("p", { text: "Please add an OPDS server in the plugin settings to browse books." });

    const btn = msg.createEl("button", { text: "Open Settings", cls: "mod-cta" });
    btn.onclick = () => {
      this.plugin.app.setting.open();
      this.plugin.app.setting.openTabById("opds-client");
    };
  }
}

function mergeCatalogEntries(partial: any, complete: any): any {
  const merged = { ...partial, ...complete };
  merged.link = mergeCatalogLinks(partial.link || [], complete.link || []);
  merged.author = complete.author?.length ? complete.author : partial.author;
  merged.category = complete.category?.length ? complete.category : partial.category;
  merged.summary = complete.summary || partial.summary;
  merged.content = complete.content || partial.content;
  merged.rights = complete.rights || partial.rights;
  merged.dcTerms = { ...(partial.dcTerms || {}), ...(complete.dcTerms || {}) };
  return merged;
}

function mergeCatalogLinks(partialLinks: any[], completeLinks: any[]): any[] {
  const merged = [...completeLinks];
  const keys = new Set(
    completeLinks.map(l => `${l.rel}|${l.href}|${l.type || ""}`)
  );
  for (const link of partialLinks) {
    const key = `${link.rel}|${link.href}|${link.type || ""}`;
    if (!keys.has(key)) {
      merged.push(link);
      keys.add(key);
    }
  }
  return merged;
}
