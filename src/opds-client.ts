import { XMLParser } from "fast-xml-parser";
import { requestUrl, RequestUrlResponse } from "obsidian";
import type {
  OPDSFeed,
  OPDSEntry,
  OPDSLink,
  OPDSPerson,
  OPDSCategory,
  OPDSFacetGroup,
  OPDSFacet,
  OPDSDCTerms,
  OPDSBook,
  OPDSLibrary,
  OPDSCatalog,
  OPDSAuthentication
} from "./types/opds";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: true,
  maxTagDepth: 50,
  isArray: (name) => [
    "entry",
    "link",
    "author",
    "contributor",
    "category",
    "facetGroup",
    "facet",
    "catalog",
    "subject",
    "identifier"
  ].includes(name)
});

const FACET_REL = "http://opds-spec.org/facet";
const SHELF_REL = "http://opds-spec.org/shelf";
const SUBSCRIPTIONS_REL = "http://opds-spec.org/subscriptions";
const FEATURED_REL = "http://opds-spec.org/featured";
const RECOMMENDED_REL = "http://opds-spec.org/recommended";
const CRAWLABLE_REL = "http://opds-spec.org/crawlable";
const SORT_PREFIX = "http://opds-spec.org/sort/";

export function isShelfRel(rel: string): boolean {
  return rel === SHELF_REL || rel === SUBSCRIPTIONS_REL;
}

export function isFacetRel(rel: string): boolean {
  return rel === FACET_REL;
}

export function isSortOrDiscoveryRel(rel: string): boolean {
  return (
    rel.startsWith(SORT_PREFIX) ||
    rel === FEATURED_REL ||
    rel === RECOMMENDED_REL ||
    rel === CRAWLABLE_REL
  );
}

export function isNavigationRel(rel: string): boolean {
  return (
    rel.includes("catalog") ||
    rel.includes("subsection") ||
    rel === "http://opds-spec.org/catalog" ||
    rel === "start" ||
    isShelfRel(rel) ||
    isSortOrDiscoveryRel(rel)
  );
}

export function classifyCatalogKind(rel: string): "catalog" | "shelf" | "subscription" | "sort" | "featured" {
  if (rel === SHELF_REL) return "shelf";
  if (rel === SUBSCRIPTIONS_REL) return "subscription";
  if (rel === FEATURED_REL) return "featured";
  if (rel.startsWith(SORT_PREFIX) || rel === RECOMMENDED_REL || rel === CRAWLABLE_REL) return "sort";
  return "catalog";
}

export function findNavigationLink(links: Array<{ rel: string; href: string }>): { rel: string; href: string } | null {
  for (const l of links) {
    if (isNavigationRel(l.rel)) return l;
  }
  return null;
}

export class OPDSClient {
  private baseUrl: string;
  private auth?: OPDSAuthentication;
  private token?: string;
  private tokenExpiresAt = 0;
  private username?: string;
  private password?: string;

  constructor(baseUrl: string, auth?: OPDSAuthentication) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = auth;
  }

  setCredentials(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  setToken(token: string) {
    this.token = token;
    this.tokenExpiresAt = 0;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Accept": "application/atom+xml;profile=opds-catalog;kind=acquisition, application/atom+xml;profile=opds-catalog;kind=navigation, application/atom+xml;q=0.9, */*;q=0.8"
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    } else if (this.username && this.password) {
      const credentials = btoa(`${this.username}:${this.password}`);
      headers["Authorization"] = `Basic ${credentials}`;
    }

    return headers;
  }

  private isTokenValid(): boolean {
    return Boolean(this.token) && (this.tokenExpiresAt === 0 || Date.now() < this.tokenExpiresAt);
  }

  private async ensureAuth(): Promise<void> {
    if (this.auth?.type !== "oauth2") return;
    if (this.isTokenValid()) return;
    const token = await this.authenticate(true);
    if (!token) {
      throw new Error("OAuth2 authentication failed. Check Token URL and client credentials.");
    }
  }

  private async requestFeed(url: string, allowRetry = true): Promise<RequestUrlResponse> {
    await this.ensureAuth();
    let response: RequestUrlResponse;
    try {
      response = await requestUrl({
        url: url,
        headers: this.getHeaders()
      });
    } catch (e: any) {
      const status = e?.status;
      if (status === 401 && allowRetry && this.auth?.type === "oauth2") {
        this.token = undefined;
        this.tokenExpiresAt = 0;
        return this.requestFeed(url, false);
      }
      if (status && status !== 200) {
        return { status, text: e?.text || "", arrayBuffer: e?.arrayBuffer || new ArrayBuffer(0), json: {}, headers: e?.headers || {} } as RequestUrlResponse;
      }
      throw new Error("Failed to fetch " + url + " - " + (e.message || e));
    }

    if (response.status === 401 && allowRetry && this.auth?.type === "oauth2") {
      this.token = undefined;
      this.tokenExpiresAt = 0;
      return this.requestFeed(url, false);
    }

    return response;
  }

  private async fetchFeed(url: string): Promise<OPDSFeed> {
    const response = await this.requestFeed(url);

    if (response.status !== 200) {
      if (response.status === 401) {
        throw new Error("Authentication failed (401) from " + url);
      }
      throw new Error("Got status " + response.status + " from " + url);
    }

    return this.parseFeed(response.text, url);
  }

  private parseFeed(xml: string, baseUrl: string): OPDSFeed {
    const result = parser.parse(xml);
    const feed = result.feed || result;
    const links = this.parseLinks(feed.link, baseUrl);

    return {
      id: this.getText(feed.id) || baseUrl,
      title: this.getText(feed.title) || "Untitled",
      updated: this.getText(feed.updated) || new Date().toISOString(),
      author: this.parseAuthors(feed.author),
      link: links,
      entry: this.parseEntries(feed.entry, baseUrl),
      facetGroup: this.parseFacetGroups(feed.facetGroup) ?? this.parseFacetLinks(links),
      startIndex: parseInt(this.getText(feed["opensearch:startIndex"]) || "0", 10),
      itemsPerPage: parseInt(this.getText(feed["opensearch:itemsPerPage"]) || "0", 10),
      totalResults: parseInt(this.getText(feed["opensearch:totalResults"]) || "0", 10)
    };
  }

  private parseAuthors(authors: unknown): OPDSPerson[] {
    if (!authors) return [];
    const authorArray = Array.isArray(authors) ? authors : [authors];
    return authorArray.map(a => ({
      name: this.getText(a.name) || "",
      uri: this.getText(a.uri),
      email: this.getText(a.email)
    }));
  }

  private parseLinks(links: unknown, baseUrl: string): OPDSLink[] {
    if (!links) return [];
    const linkArray = Array.isArray(links) ? links : [links];
    return linkArray.map(l => {
      const link: OPDSLink = {
        rel: l["@_rel"] || "",
        href: this.resolveUrl(l["@_href"] || "", baseUrl),
        type: l["@_type"],
        title: l["@_title"],
        length: l["@_length"] ? parseInt(l["@_length"], 10) : undefined,
        properties: l["@_properties"] ? (() => { try { return JSON.parse(l["@_properties"]); } catch { return undefined; } })() : undefined
      };

      const props: Record<string, unknown> = { ...(link.properties || {}) };
      let hasExtra = false;

      const facetGroup = l["@_opds:facetGroup"] ?? l["@_facetGroup"];
      if (facetGroup !== undefined) {
        props["opds:facetGroup"] = String(facetGroup);
        hasExtra = true;
      }
      const activeFacet = l["@_opds:activeFacet"] ?? l["@_activeFacet"];
      if (activeFacet !== undefined) {
        props["opds:activeFacet"] = String(activeFacet).toLowerCase() === "true" || activeFacet === true;
        hasExtra = true;
      }
      const thrCount = l["@_thr:count"] ?? l["@_count"];
      if (thrCount !== undefined) {
        props["thr:count"] = parseInt(String(thrCount), 10) || 0;
        hasExtra = true;
      }
      if (hasExtra) {
        link.properties = props;
      }

      return link;
    });
  }

  private parseEntries(entries: unknown, baseUrl: string): OPDSEntry[] {
    if (!entries) return [];
    const entryArray = Array.isArray(entries) ? entries : [entries];
    return entryArray.map(e => this.parseEntry(e, baseUrl));
  }

  private parseEntry(entry: unknown, baseUrl: string): OPDSEntry {
    const links = this.parseLinks(entry.link, baseUrl);
    const dcTerms = this.parseDCTerms(entry);

    return {
      id: this.getText(entry.id) || "",
      title: this.getText(entry.title) || "Untitled",
      updated: this.getText(entry.updated) || new Date().toISOString(),
      published: this.getText(entry.published),
      author: this.parseAuthors(entry.author),
      contributor: this.parseAuthors(entry.contributor),
      category: this.parseCategories(entry.category),
      summary: this.getText(entry.summary),
      content: this.getText(entry.content),
      link: links,
      rights: this.getText(entry.rights),
      dcTerms
    };
  }

  private parseCategories(categories: unknown): OPDSCategory[] {
    if (!categories) return [];
    const catArray = Array.isArray(categories) ? categories : [categories];
    return catArray.map(c => ({
      scheme: c["@_scheme"] || "",
      term: c["@_term"] || "",
      label: c["@_label"]
    }));
  }

  private parseFacetGroups(groups: unknown): OPDSFacetGroup[] | undefined {
    if (!groups) return undefined;
    const groupArray = Array.isArray(groups) ? groups : [groups];
    const parsed = groupArray.map(g => ({
      title: this.getText(g.title) || "",
      facet: this.parseFacets(g.facet)
    })).filter(g => g.facet.length > 0);
    return parsed.length > 0 ? parsed : undefined;
  }

  private parseFacets(facets: unknown): OPDSFacet[] {
    if (!facets) return [];
    const facetArray = Array.isArray(facets) ? facets : [facets];
    return facetArray.map(f => ({
      value: f["@_value"] || "",
      count: parseInt(f["@_count"] || "0", 10),
      title: this.getText(f.title),
      href: f["@_href"] ? String(f["@_href"]) : undefined,
      active: String(f["@_activeFacet"] || f["@_opds:activeFacet"] || "").toLowerCase() === "true"
    }));
  }

  private parseFacetLinks(links: OPDSLink[]): OPDSFacetGroup[] | undefined {
    const facetLinks = links.filter(l => isFacetRel(l.rel));
    if (facetLinks.length === 0) return undefined;

    const groups = new Map<string, OPDSFacet[]>();
    for (const link of facetLinks) {
      const props = link.properties || {};
      const groupTitle = (props["opds:facetGroup"] as string) || "Facets";
      const countRaw = props["thr:count"];
      const activeRaw = props["opds:activeFacet"];
      const facet: OPDSFacet = {
        value: link.href,
        href: link.href,
        title: link.title,
        count: typeof countRaw === "number" ? countRaw : parseInt(String(countRaw ?? "0"), 10) || 0,
        active: activeRaw === true || String(activeRaw ?? "").toLowerCase() === "true"
      };
      const list = groups.get(groupTitle) || [];
      list.push(facet);
      groups.set(groupTitle, list);
    }

    return Array.from(groups.entries()).map(([title, facet]) => ({ title, facet }));
  }

  private parseDCTerms(entry: unknown): OPDSDCTerms | undefined {
    const terms: OPDSDCTerms = {};
    let hasTerms = false;

    const dcFields = [
      "identifier", "issued", "modified", "language", "publisher",
      "subject", "description", "type", "format", "relation",
      "coverage", "rights"
    ];

    for (const field of dcFields) {
      const value = entry[`dcterms:${field}`] || entry[`dc:${field}`];
      if (value) {
        hasTerms = true;
        if (field === "subject" || field === "identifier") {
          const arr = Array.isArray(value) ? value : [value];
          terms[field as keyof OPDSDCTerms] = arr.map(v => this.getText(v));
        } else {
          terms[field as keyof OPDSDCTerms] = this.getText(value);
        }
      }
    }

    return hasTerms ? terms : undefined;
  }

  private getText(node: unknown): string | undefined {
    if (node === null || node === undefined) return undefined;
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (typeof node === "object") {
      if ("#text" in node) return node["#text"] as string;
    }
    return undefined;
  }

  private resolveUrl(href: string, baseUrl: string): string {
    if (!href) return "";
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  async getCatalog(url?: string): Promise<OPDSFeed> {
    const targetUrl = url || this.baseUrl;
    return this.fetchFeed(targetUrl);
  }

  async detectOpdsVersion(): Promise<string> {
    const response = await this.requestFeed(this.baseUrl);

    if (response.status !== 200) {
      throw new Error("Got status " + response.status + " while detecting OPDS version");
    }

    const headers = response.headers || {};
    let contentType = "";
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-type") {
        contentType = String(headers[key]);
        break;
      }
    }

    return detectOpdsVersionFromResponse(contentType, response.text);
  }

  async getLibrary(): Promise<OPDSLibrary> {
    const feed = await this.getCatalog();
    const catalogs: OPDSCatalog[] = [];
    const seenUrls = new Set<string>();

    const addCatalog = (title: string, href: string, rel: string): void => {
      if (!href || seenUrls.has(href)) return;
      seenUrls.add(href);
      const type: OPDSCatalog["type"] =
        rel.includes("search") ? "search" :
        rel.includes("acquisition") ? "acquisition" :
        "navigation";
      catalogs.push({
        id: href,
        title: title || "Catalog",
        url: href,
        type,
        kind: classifyCatalogKind(rel)
      });
    };

    for (const link of feed.link) {
      if (isNavigationRel(link.rel) || link.rel === "" || link.rel === "alternate") {
        addCatalog(link.title || "Catalog", link.href, link.rel);
      }
    }

    for (const entry of feed.entry) {
      for (const l of entry.link) {
        if (isNavigationRel(l.rel) && !isFacetRel(l.rel)) {
          addCatalog(entry.title, l.href, l.rel);
        }
      }
    }

    return {
      id: feed.id,
      title: feed.title,
      description: feed.entry[0]?.summary,
      catalogs,
      authentication: this.auth
    };
  }

  private findSearchLink(links: OPDSLink[]): OPDSLink | null {
    const searchLinks = links.filter(l => l.rel === "search" || l.rel === "http://opds-spec.org/search");
    if (searchLinks.length === 0) return null;
    return searchLinks.find(l => l.href.includes("{searchTerms}")) || searchLinks[0];
  }

  async getBooks(catalogUrl: string, searchQuery?: string): Promise<OPDSFeed> {
    let url = catalogUrl;
    if (searchQuery) {
      const feed = await this.getCatalog(catalogUrl);
      const searchLink = this.findSearchLink(feed.link);
      if (searchLink) {
        url = searchLink.href.replace("{searchTerms}", encodeURIComponent(searchQuery));
      } else {
        return {
          id: "",
          title: "Search Results",
          updated: new Date().toISOString(),
          author: [],
          link: [],
          entry: []
        };
      }
    }
    return this.fetchFeed(url);
  }

  async getBookDetails(bookUrl: string): Promise<OPDSBook> {
    const feed = await this.fetchFeed(bookUrl);
    let entry = feed.entry[0];

    if (!entry && feed.link.length > 0) {
      entry = {
        id: feed.id,
        title: feed.title,
        updated: feed.updated,
        author: feed.author,
        category: [],
        link: feed.link
      };
    }

    if (!entry) {
      throw new Error("Book not found at " + bookUrl);
    }

    return this.convertEntryToBook(entry, bookUrl);
  }

  private convertEntryToBook(entry: OPDSEntry, baseUrl: string): OPDSBook {
    const coverLink = entry.link.find(l =>
      l.rel === "http://opds-spec.org/image" ||
      l.rel === "http://opds-spec.org/image/thumbnail" ||
      l.type?.startsWith("image/")
    );

    const downloadLinks = entry.link.filter(l =>
      l.rel === "http://opds-spec.org/acquisition" ||
      l.rel === "http://opds-spec.org/acquisition/open-access" ||
      l.rel === "http://opds-spec.org/acquisition/borrow" ||
      l.rel === "http://opds-spec.org/acquisition/buy" ||
      (l.rel === "alternate" && l.type?.match(/application\/(epub|pdf|mobi)/))
    );

    const authors = entry.author.map(a => a.name).filter(Boolean);
    const subjects = entry.category
      .filter(c => c.scheme.includes("subject") || c.scheme.includes("genre"))
      .map(c => c.term || c.label).filter(Boolean);
    const languages = entry.category
      .filter(c => c.scheme.includes("language"))
      .map(c => c.term).filter(Boolean);

    const identifiers: Record<string, string> = {};
    for (const cat of entry.category) {
      if (cat.scheme.includes("isbn")) identifiers.isbn = cat.term;
      else if (cat.scheme.includes("doi")) identifiers.doi = cat.term;
    }

    return {
      ...entry,
      coverUrl: coverLink?.href,
      downloadLinks: downloadLinks.map(l => ({
        rel: l.rel,
        type: l.type || "",
        href: l.href,
        title: l.title
      })),
      authors,
      subjects,
      languages,
      publisher: entry.dcTerms?.publisher,
      publishedDate: entry.dcTerms?.issued,
      description: entry.summary || entry.dcTerms?.description,
      identifiers
    };
  }

  async downloadBook(downloadUrl: string): Promise<ArrayBuffer> {
    const response = await this.requestFeed(downloadUrl);

    if (response.status !== 200) {
      throw new Error(`Download failed: HTTP ${response.status} from ${downloadUrl}`);
    }

    return response.arrayBuffer;
  }

  async fetchCover(url: string): Promise<string> {
    const response = await this.requestFeed(url);

    if (response.status !== 200) {
      throw new Error(`Cover fetch failed: HTTP ${response.status} from ${url}`);
    }

    const headers = response.headers || {};
    let contentType = "image/jpeg";
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-type") {
        contentType = String(headers[key]).split(";")[0].trim() || contentType;
        break;
      }
    }

    const bytes = new Uint8Array(response.arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
  }

  async searchBooks(query: string, catalogUrl?: string): Promise<OPDSFeed> {
    const feed = await this.getCatalog(catalogUrl);
    const searchLink = this.findSearchLink(feed.link);

    if (!searchLink) {
      throw new Error("Search not supported by this catalog");
    }

    const searchUrl = searchLink.href.includes("{searchTerms}")
      ? searchLink.href.replace("{searchTerms}", encodeURIComponent(query))
      : searchLink.href;
    return this.fetchFeed(searchUrl);
  }

  async authenticate(force = false): Promise<string | null> {
    if (!this.auth || !this.auth.tokenUrl) {
      return null;
    }

    if (!force && this.isTokenValid()) {
      return this.token ?? null;
    }

    if (this.auth.type === "oauth2" && this.auth.clientId && this.auth.clientSecret) {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.auth.clientId,
        client_secret: this.auth.clientSecret
      });

      if (this.auth.scope) {
        params.append("scope", this.auth.scope);
      }

      try {
        const response: RequestUrlResponse = await requestUrl({
          url: this.auth.tokenUrl,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });

        if (response.status === 200) {
          const data = JSON.parse(response.text);
          if (!data.access_token) {
            console.error("OAuth2 token response missing access_token");
            return null;
          }
          this.token = data.access_token;
          const expiresIn = typeof data.expires_in === "number" ? data.expires_in : parseInt(String(data.expires_in || "0"), 10);
          this.tokenExpiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
          return this.token;
        } else {
          console.error("OAuth2 token request failed:", response.status, response.text);
          return null;
        }
      } catch (e: any) {
        console.error("OAuth2 token request error:", e.message || e);
        return null;
      }
    }

    return null;
  }
}

export function createOPDSClient(baseUrl: string, auth?: OPDSAuthentication): OPDSClient {
  return new OPDSClient(baseUrl, auth);
}

export function detectOpdsVersionFromResponse(contentType: string, body: string): string {
  const ct = (contentType || "").toLowerCase();
  const text = (body || "").trim();

  if (ct.includes("opds+json") || (ct.includes("json") && (text.startsWith("{") || text.startsWith("[")))) {
    return "OPDS 2.0";
  }

  const looksLikeAtom =
    ct.includes("profile=opds-catalog") ||
    ct.includes("atom+xml") ||
    text.startsWith("<?xml") ||
    text.includes("<feed");

  if (looksLikeAtom) {
    if (
      text.includes("opds:facetGroup") ||
      text.includes("indirectAcquisition") ||
      text.includes("http://opds-spec.org/facet")
    ) {
      return "OPDS 1.2";
    }
    return "OPDS 1.x";
  }

  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      if (data && (data["@context"] || data.metadata || data.collections || data.publications)) {
        return "OPDS 2.0";
      }
    } catch {
      // not JSON
    }
  }

  return "Unknown";
}