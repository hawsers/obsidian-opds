import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestUrl } from "./__mocks__/obsidian";

vi.mock("obsidian", () => import("./__mocks__/obsidian"));

import { OPDSClient, createOPDSClient, detectOpdsVersionFromResponse, isNavigationRel, isShelfRel, isFacetRel, classifyCatalogKind, findNavigationLink } from "../src/opds-client";

const SAMPLE_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:test:feed:1</id>
  <title>Test Library</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <author><name>Test Author</name></author>
  <link rel="self" href="/api/opds" type="application/atom+xml"/>
  <link rel="start" href="/api/opds/catalog" title="Home" type="application/atom+xml"/>
  <entry>
    <id>urn:book:1</id>
    <title>Test Book</title>
    <updated>2026-01-15T00:00:00Z</updated>
    <author><name>Author One</name></author>
    <category scheme="http://example.com/subject" term="Fiction" label="Fiction"/>
    <summary>A test book summary</summary>
    <link rel="http://opds-spec.org/image/thumbnail" href="/api/books/1/thumb" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/api/books/1/download" type="application/epub+zip" title="EPUB"/>
    <link rel="http://opds-spec.org/acquisition" href="/api/books/1/pdf" type="application/pdf" title="PDF"/>
  </entry>
  <entry>
    <id>urn:book:2</id>
    <title>Second Book</title>
    <updated>2026-02-01T00:00:00Z</updated>
    <author><name>Author Two</name></author>
    <content>Science Fiction</content>
    <link rel="http://opds-spec.org/image" href="/api/books/2/cover" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition/open-access" href="/api/books/2/download" type="application/pdf"/>
  </entry>
</feed>`;

const SAMPLE_NAV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:test:catalog</id>
  <title>OPDS Catalog</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="start" href="/api/opds" title="Home" type="application/atom+xml"/>
  <entry>
    <id>urn:catalog:all</id>
    <title>All Books</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/catalog" href="/api/opds/catalog" type="application/atom+xml"/>
  </entry>
  <entry>
    <id>urn:catalog:recent</id>
    <title>Recent Books</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" href="/api/opds/recent" type="application/atom+xml"/>
  </entry>
</feed>`;

const SAMPLE_SEARCH_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>urn:test:search</id>
  <title>Search Results</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="search" href="/api/opds/search?q={searchTerms}" type="application/opensearchdescription+xml"/>
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>urn:book:1</id>
    <title>Search Result Book</title>
    <updated>2026-01-15T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" href="/api/books/1/download" type="application/epub+zip"/>
  </entry>
</feed>`;

const SAMPLE_FACET_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:thr="http://purl.org/syndication/thread/1.0/">
  <id>urn:test:facet</id>
  <title>Faceted Catalog</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="http://opds-spec.org/facet"
        href="/opds/fiction?sort=title"
        opds:facetGroup="Sort by"
        opds:activeFacet="true"
        thr:count="42"
        title="Title"/>
  <link rel="http://opds-spec.org/facet"
        href="/opds/fiction?sort=author"
        opds:facetGroup="Sort by"
        thr:count="17"
        title="Author"/>
  <link rel="http://opds-spec.org/facet"
        href="/opds/fiction?lang=en"
        opds:facetGroup="Language"
        thr:count="10"
        title="English"/>
  <entry>
    <id>urn:book:1</id>
    <title>Book</title>
    <updated>2026-01-15T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" href="/api/books/1/download" type="application/epub+zip"/>
  </entry>
</feed>`;

const SAMPLE_SHELF_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:test:shelves</id>
  <title>My Library</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <entry>
    <id>urn:shelf:favorites</id>
    <title>Favorites</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/shelf" href="/opds/shelf/favorites" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
  <entry>
    <id>urn:shelf:reading</id>
    <title>Reading List</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/subscriptions" href="/opds/subscriptions" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  </entry>
  <entry>
    <id>urn:sort:new</id>
    <title>New Arrivals</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/sort/new" href="/opds/new" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
</feed>`;

function mockFeedXml(xml: string) {
  vi.mocked(requestUrl).mockResolvedValueOnce({
    status: 200, text: xml, arrayBuffer: new ArrayBuffer(0), json: {}
  } as any);
}

describe("OPDSClient", () => {
  let client: OPDSClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createOPDSClient("http://localhost:3000/api/v1/opds");
  });

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const c = createOPDSClient("http://localhost:3000/api/v1/opds/");
      expect((c as any).baseUrl).toBe("http://localhost:3000/api/v1/opds");
    });

    it("stores auth config", () => {
      const auth = { type: "basic" as const };
      const c = createOPDSClient("http://localhost:3000", auth);
      expect((c as any).auth).toEqual(auth);
    });
  });

  describe("setCredentials", () => {
    it("stores username and password", () => {
      client.setCredentials("user", "pass");
      expect((client as any).username).toBe("user");
      expect((client as any).password).toBe("pass");
    });
  });

  describe("setToken", () => {
    it("stores token", () => {
      client.setToken("my-token");
      expect((client as any).token).toBe("my-token");
    });
  });

  describe("getHeaders", () => {
    it("returns default Accept header", () => {
      const headers = (client as any).getHeaders();
      expect(headers["Accept"]).toContain("opds-catalog");
    });

    it("includes Basic auth when credentials set", () => {
      client.setCredentials("admin", "secret");
      const headers = (client as any).getHeaders();
      expect(headers["Authorization"]).toMatch(/^Basic /);
      const decoded = atob(headers["Authorization"].replace("Basic ", ""));
      expect(decoded).toBe("admin:secret");
    });

    it("includes Bearer token when set", () => {
      client.setToken("test-token-123");
      const headers = (client as any).getHeaders();
      expect(headers["Authorization"]).toBe("Bearer test-token-123");
    });

    it("Bearer token takes precedence over Basic auth", () => {
      client.setCredentials("user", "pass");
      client.setToken("bearer-token");
      const headers = (client as any).getHeaders();
      expect(headers["Authorization"]).toBe("Bearer bearer-token");
    });
  });

  describe("resolveUrl", () => {
    it("resolves relative URLs against base", () => {
      const result = (client as any).resolveUrl("/api/books/1", "http://localhost:3000/api/opds");
      expect(result).toBe("http://localhost:3000/api/books/1");
    });

    it("keeps absolute URLs as-is", () => {
      const result = (client as any).resolveUrl("http://other.com/path", "http://localhost:3000");
      expect(result).toBe("http://other.com/path");
    });

    it("returns empty string for empty href", () => {
      const result = (client as any).resolveUrl("", "http://localhost:3000");
      expect(result).toBe("");
    });
  });

  describe("getText", () => {
    it("returns undefined for null/undefined", () => {
      expect((client as any).getText(null)).toBeUndefined();
      expect((client as any).getText(undefined)).toBeUndefined();
    });

    it("returns string as-is", () => {
      expect((client as any).getText("hello")).toBe("hello");
    });

    it("extracts #text from object", () => {
      expect((client as any).getText({ "#text": "content" })).toBe("content");
    });

    it("returns undefined for object without #text", () => {
      expect((client as any).getText({ foo: "bar" })).toBeUndefined();
    });

    it("converts number to string", () => {
      expect((client as any).getText(42)).toBe("42");
    });
  });

  describe("parseAuthors", () => {
    it("returns empty array for null", () => {
      expect((client as any).parseAuthors(null)).toEqual([]);
    });

    it("parses single author object", () => {
      const result = (client as any).parseAuthors({ name: "John Doe" });
      expect(result).toEqual([{ name: "John Doe", uri: undefined, email: undefined }]);
    });

    it("parses array of authors", () => {
      const result = (client as any).parseAuthors([
        { name: "Author A" },
        { name: "Author B", uri: "http://example.com", email: "a@b.com" }
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Author A");
      expect(result[1].uri).toBe("http://example.com");
      expect(result[1].email).toBe("a@b.com");
    });

    it("handles #text wrapped name", () => {
      const result = (client as any).parseAuthors({ name: { "#text": "Wrapped Name" } });
      expect(result[0].name).toBe("Wrapped Name");
    });
  });

  describe("parseLinks", () => {
    it("returns empty array for null", () => {
      expect((client as any).parseLinks(null, "http://base")).toEqual([]);
    });

    it("parses link attributes", () => {
      const result = (client as any).parseLinks(
        { "@_rel": "next", "@_href": "/page/2", "@_type": "application/xml", "@_title": "Next" },
        "http://localhost:3000"
      );
      expect(result[0]).toEqual({
        rel: "next",
        href: "http://localhost:3000/page/2",
        type: "application/xml",
        title: "Next",
        length: undefined,
        properties: undefined
      });
    });

    it("resolves relative URLs", () => {
      const result = (client as any).parseLinks(
        { "@_rel": "self", "@_href": "/catalog" },
        "http://localhost:3000/api"
      );
      expect(result[0].href).toBe("http://localhost:3000/catalog");
    });

    it("parses length attribute", () => {
      const result = (client as any).parseLinks(
        { "@_rel": "acquisition", "@_href": "/file", "@_length": "1024" },
        "http://localhost"
      );
      expect(result[0].length).toBe(1024);
    });
  });

  describe("parseCategories", () => {
    it("returns empty array for null", () => {
      expect((client as any).parseCategories(null)).toEqual([]);
    });

    it("parses category attributes", () => {
      const result = (client as any).parseCategories({
        "@_scheme": "http://example.com/subject",
        "@_term": "Fiction",
        "@_label": "Fiction Books"
      });
      expect(result).toEqual([{
        scheme: "http://example.com/subject",
        term: "Fiction",
        label: "Fiction Books"
      }]);
    });
  });

  describe("parseDCTerms", () => {
    it("returns undefined when no dc terms present", () => {
      expect((client as any).parseDCTerms({ title: "test" })).toBeUndefined();
    });

    it("parses dcterms:publisher", () => {
      const result = (client as any).parseDCTerms({ "dcterms:publisher": "Test Publisher" });
      expect(result).toEqual({ publisher: "Test Publisher" });
    });

    it("parses dc:subject as array", () => {
      const result = (client as any).parseDCTerms({ "dc:subject": ["Fiction", "Drama"] });
      expect(result).toEqual({ subject: ["Fiction", "Drama"] });
    });

    it("parses single dc:subject as wrapped array", () => {
      const result = (client as any).parseDCTerms({ "dc:subject": "Single Subject" });
      expect(result).toEqual({ subject: ["Single Subject"] });
    });
  });

  describe("parseFeed - acquisition feed", () => {
    beforeEach(() => { mockFeedXml(SAMPLE_FEED_XML); });

    it("parses basic feed metadata", async () => {
      const feed = await client.getCatalog();
      expect(feed.id).toBe("urn:test:feed:1");
      expect(feed.title).toBe("Test Library");
      expect(feed.updated).toBe("2026-01-01T00:00:00Z");
    });

    it("parses feed author", async () => {
      const feed = await client.getCatalog();
      expect(feed.author).toHaveLength(1);
      expect(feed.author[0].name).toBe("Test Author");
    });

    it("parses feed links", async () => {
      const feed = await client.getCatalog();
      expect(feed.link.length).toBeGreaterThanOrEqual(2);
      expect(feed.link.find(l => l.rel === "self")).toBeDefined();
      expect(feed.link.find(l => l.rel === "start")).toBeDefined();
    });

    it("parses entries", async () => {
      const feed = await client.getCatalog();
      expect(feed.entry).toHaveLength(2);
      expect(feed.entry[0].title).toBe("Test Book");
      expect(feed.entry[1].title).toBe("Second Book");
    });

    it("parses entry authors", async () => {
      const feed = await client.getCatalog();
      expect(feed.entry[0].author[0].name).toBe("Author One");
    });

    it("parses entry categories", async () => {
      const feed = await client.getCatalog();
      const cats = feed.entry[0].category;
      expect(cats[0].term).toBe("Fiction");
      expect(cats[0].scheme).toBe("http://example.com/subject");
    });

    it("parses entry summary and content", async () => {
      const feed = await client.getCatalog();
      expect(feed.entry[0].summary).toBe("A test book summary");
      expect(feed.entry[1].content).toBe("Science Fiction");
    });

    it("parses entry links (image and acquisition)", async () => {
      const feed = await client.getCatalog();
      const links = feed.entry[0].link;
      expect(links.length).toBeGreaterThanOrEqual(3);
      expect(links.find(l => l.rel.includes("thumbnail"))).toBeDefined();
      expect(links.find(l => l.title === "EPUB")).toBeDefined();
    });
  });

  describe("parseFeed - navigation feed", () => {
    it("parses navigation entries with catalog/subsection links", async () => {
      mockFeedXml(SAMPLE_NAV_FEED);
      const feed = await client.getCatalog();
      expect(feed.entry).toHaveLength(2);
      const allBooks = feed.entry.find(e => e.title === "All Books");
      expect(allBooks!.link.find(l => l.rel === "http://opds-spec.org/catalog")).toBeDefined();
      const recent = feed.entry.find(e => e.title === "Recent Books");
      expect(recent!.link.find(l => l.rel === "subsection")).toBeDefined();
    });
  });

  describe("parseFeed - search feed", () => {
    it("parses search links", async () => {
      mockFeedXml(SAMPLE_SEARCH_FEED);
      const feed = await client.getCatalog();
      const searchLink = feed.link.find(l => l.rel === "search");
      expect(searchLink).toBeDefined();
      expect(searchLink!.href).toContain("{searchTerms}");
    });

    it("opensearch totalResults parses numeric values correctly", async () => {
      mockFeedXml(SAMPLE_SEARCH_FEED);
      const feed = await client.getCatalog();
      // fast-xml-parser with parseTagValue:true converts "1" to number 1,
      // and getText() now handles numbers by converting to string
      expect(feed.totalResults).toBe(1);
    });
  });

  describe("getLibrary", () => {
    it("extracts catalogs from feed links", async () => {
      mockFeedXml(SAMPLE_NAV_FEED);
      const library = await client.getLibrary();
      expect(library.title).toBe("OPDS Catalog");
      expect(library.catalogs.length).toBeGreaterThanOrEqual(1);
    });

    it("creates catalog entries for feed links with start/catalog rel", async () => {
      mockFeedXml(SAMPLE_NAV_FEED);
      const library = await client.getLibrary();
      const homeCatalog = library.catalogs.find(c => c.title === "Home");
      expect(homeCatalog).toBeDefined();
      expect(homeCatalog!.type).toBe("navigation");
    });
  });

  describe("getBooks", () => {
    it("fetches feed for catalog URL", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const feed = await client.getBooks("http://localhost:3000/api/catalog");
      expect(feed.entry).toHaveLength(2);
    });
  });

  describe("getBookDetails", () => {
    it("converts entry to book format", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.title).toBe("Test Book");
      expect(book.authors).toContain("Author One");
      expect(book.coverUrl).toContain("thumb");
      expect(book.downloadLinks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("convertEntryToBook", () => {
    it("extracts cover URL from image links", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.coverUrl).toBeDefined();
      expect(book.coverUrl).toContain("thumb");
    });

    it("extracts multiple download links", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.downloadLinks.length).toBeGreaterThanOrEqual(2);
      expect(book.downloadLinks.find(d => d.type.includes("epub"))).toBeDefined();
      expect(book.downloadLinks.find(d => d.type.includes("pdf"))).toBeDefined();
    });

    it("extracts author names as strings", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.authors).toEqual(["Author One"]);
    });

    it("extracts subjects from categories", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.subjects).toContain("Fiction");
    });

    it("extracts description from summary", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/1");
      expect(book.description).toBe("A test book summary");
    });

    it("handles entry without dcTerms gracefully", async () => {
      mockFeedXml(SAMPLE_FEED_XML);
      const book = await client.getBookDetails("http://localhost:3000/api/books/2");
      expect(book.publisher).toBeUndefined();
      expect(book.publishedDate).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws on non-200 status", async () => {
      vi.mocked(requestUrl).mockResolvedValueOnce({ status: 404, text: "" } as any);
      await expect(client.getCatalog()).rejects.toThrow("Got status 404");
    });

    it("throws on network error", async () => {
      vi.mocked(requestUrl).mockRejectedValueOnce(new Error("Network error"));
      await expect(client.getCatalog()).rejects.toThrow("Failed to fetch");
    });
  });

  describe("detectOpdsVersion", () => {
    it("detects OPDS 1.x from atom content type", async () => {
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: "<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>",
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        headers: { "content-type": "application/atom+xml;profile=opds-catalog;kind=navigation" }
      } as any);
      const version = await client.detectOpdsVersion();
      expect(version).toBe("OPDS 1.x");
    });

    it("detects OPDS 1.2 from facet markers", async () => {
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: "<feed><link rel=\"http://opds-spec.org/facet\" href=\"/facets\"/></feed>",
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        headers: { "content-type": "application/atom+xml" }
      } as any);
      const version = await client.detectOpdsVersion();
      expect(version).toBe("OPDS 1.2");
    });

    it("detects OPDS 2.0 from json content type", async () => {
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: "{\"metadata\":{\"title\":\"Lib\"}}",
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        headers: { "content-type": "application/opds+json" }
      } as any);
      const version = await client.detectOpdsVersion();
      expect(version).toBe("OPDS 2.0");
    });

    it("returns Unknown for unrecognized response", async () => {
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: "not a feed",
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        headers: { "content-type": "text/plain" }
      } as any);
      const version = await client.detectOpdsVersion();
      expect(version).toBe("Unknown");
    });
  });

  describe("facet parsing", () => {
    it("parses facet links into grouped facet chips", async () => {
      mockFeedXml(SAMPLE_FACET_FEED);
      const feed = await client.getCatalog();
      expect(feed.facetGroup).toBeDefined();
      expect(feed.facetGroup).toHaveLength(2);

      const sortGroup = feed.facetGroup!.find(g => g.title === "Sort by");
      expect(sortGroup).toBeDefined();
      expect(sortGroup!.facet).toHaveLength(2);
      expect(sortGroup!.facet[0].title).toBe("Title");
      expect(sortGroup!.facet[0].active).toBe(true);
      expect(sortGroup!.facet[0].count).toBe(42);
      expect(sortGroup!.facet[0].href).toContain("sort=title");
      expect(sortGroup!.facet[1].title).toBe("Author");
      expect(sortGroup!.facet[1].active).toBe(false);
      expect(sortGroup!.facet[1].count).toBe(17);

      const langGroup = feed.facetGroup!.find(g => g.title === "Language");
      expect(langGroup).toBeDefined();
      expect(langGroup!.facet[0].title).toBe("English");
    });

    it("does not invent facet groups when none present", async () => {
      mockFeedXml(SAMPLE_NAV_FEED);
      const feed = await client.getCatalog();
      expect(feed.facetGroup).toBeUndefined();
    });
  });

  describe("shelf/subscription navigation", () => {
    it("extracts shelf and subscription entries from library", async () => {
      mockFeedXml(SAMPLE_SHELF_FEED);
      const library = await client.getLibrary();
      expect(library.catalogs).toHaveLength(3);

      const favorites = library.catalogs.find(c => c.title === "Favorites");
      expect(favorites).toBeDefined();
      expect(favorites!.kind).toBe("shelf");
      expect(favorites!.url).toContain("/shelf/favorites");

      const reading = library.catalogs.find(c => c.title === "Reading List");
      expect(reading).toBeDefined();
      expect(reading!.kind).toBe("subscription");

      const arrivals = library.catalogs.find(c => c.title === "New Arrivals");
      expect(arrivals).toBeDefined();
      expect(arrivals!.kind).toBe("sort");
    });
  });

  describe("OAuth2 client credentials", () => {
    function makeOAuthClient(tokenUrl = "http://localhost:3000/oauth/token") {
      return createOPDSClient("http://localhost:3000/api/opds", {
        type: "oauth2",
        tokenUrl,
        clientId: "cid",
        clientSecret: "csecret",
        scope: "read"
      });
    }

    function mockToken(overrides: Partial<{ access_token: string; expires_in: number }> = {}) {
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify({ access_token: "tok-1", expires_in: 3600, ...overrides }),
        arrayBuffer: new ArrayBuffer(0),
        json: {}
      } as any);
    }

    it("requests token and stores access_token with expiry", async () => {
      const c = makeOAuthClient();
      mockToken();
      const token = await c.authenticate();
      expect(token).toBe("tok-1");
      expect((c as any).token).toBe("tok-1");
      expect((c as any).tokenExpiresAt).toBeGreaterThan(Date.now());
      expect(vi.mocked(requestUrl)).toHaveBeenCalledWith(expect.objectContaining({
        url: "http://localhost:3000/oauth/token",
        method: "POST"
      }));
      const body = String(vi.mocked(requestUrl).mock.calls[0][0].body);
      expect(body).toContain("grant_type=client_credentials");
      expect(body).toContain("client_id=cid");
      expect(body).toContain("scope=read");
    });

    it("reuses cached token before expiry", async () => {
      const c = makeOAuthClient();
      mockToken();
      await c.authenticate();
      vi.clearAllMocks();
      const token = await c.authenticate();
      expect(token).toBe("tok-1");
      expect(vi.mocked(requestUrl)).not.toHaveBeenCalled();
    });

    it("refreshes token when expired", async () => {
      const c = makeOAuthClient();
      mockToken({ access_token: "old", expires_in: 3600 });
      await c.authenticate();
      (c as any).tokenExpiresAt = Date.now() - 1000;
      mockToken({ access_token: "new", expires_in: 3600 });
      const token = await c.authenticate();
      expect(token).toBe("new");
      expect((c as any).token).toBe("new");
    });

    it("returns null when token request fails", async () => {
      const c = makeOAuthClient();
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 401,
        text: "unauthorized",
        arrayBuffer: new ArrayBuffer(0),
        json: {}
      } as any);
      const token = await c.authenticate();
      expect(token).toBeNull();
    });

    it("returns null when tokenUrl missing", async () => {
      const c = createOPDSClient("http://localhost:3000", { type: "oauth2", clientId: "x", clientSecret: "y" });
      expect(await c.authenticate()).toBeNull();
    });
  });

  describe("rel classification helpers", () => {
    it("isNavigationRel matches catalog/shelf/sort/featured", () => {
      expect(isNavigationRel("http://opds-spec.org/catalog")).toBe(true);
      expect(isNavigationRel("subsection")).toBe(true);
      expect(isNavigationRel("http://opds-spec.org/shelf")).toBe(true);
      expect(isNavigationRel("http://opds-spec.org/subscriptions")).toBe(true);
      expect(isNavigationRel("http://opds-spec.org/sort/new")).toBe(true);
      expect(isNavigationRel("http://opds-spec.org/featured")).toBe(true);
      expect(isNavigationRel("http://opds-spec.org/acquisition")).toBe(false);
      expect(isNavigationRel("http://opds-spec.org/facet")).toBe(false);
      expect(isNavigationRel("next")).toBe(false);
    });

    it("isShelfRel matches shelf and subscriptions only", () => {
      expect(isShelfRel("http://opds-spec.org/shelf")).toBe(true);
      expect(isShelfRel("http://opds-spec.org/subscriptions")).toBe(true);
      expect(isShelfRel("http://opds-spec.org/sort/new")).toBe(false);
    });

    it("isFacetRel matches facet rel", () => {
      expect(isFacetRel("http://opds-spec.org/facet")).toBe(true);
      expect(isFacetRel("subsection")).toBe(false);
    });

    it("classifyCatalogKind maps rels to kinds", () => {
      expect(classifyCatalogKind("http://opds-spec.org/shelf")).toBe("shelf");
      expect(classifyCatalogKind("http://opds-spec.org/subscriptions")).toBe("subscription");
      expect(classifyCatalogKind("http://opds-spec.org/featured")).toBe("featured");
      expect(classifyCatalogKind("http://opds-spec.org/sort/popular")).toBe("sort");
      expect(classifyCatalogKind("subsection")).toBe("catalog");
    });

    it("findNavigationLink returns first nav link", () => {
      const links = [
        { rel: "http://opds-spec.org/image", href: "/img" },
        { rel: "http://opds-spec.org/shelf", href: "/shelf" }
      ];
      expect(findNavigationLink(links)?.href).toBe("/shelf");
      expect(findNavigationLink([{ rel: "next", href: "/p2" }])).toBeNull();
    });
  });
});

describe("detectOpdsVersionFromResponse", () => {
  it("detects OPDS 2.0 from opds+json content type", () => {
    expect(detectOpdsVersionFromResponse("application/opds+json", "{}")).toBe("OPDS 2.0");
  });

  it("detects OPDS 2.0 from JSON body with opds context", () => {
    expect(detectOpdsVersionFromResponse("application/json", '{"@context":"https://opds.io/schema"}')).toBe("OPDS 2.0");
  });

  it("detects OPDS 1.x from catalog profile content type", () => {
    expect(detectOpdsVersionFromResponse(
      "application/atom+xml;profile=opds-catalog;kind=acquisition",
      "<feed></feed>"
    )).toBe("OPDS 1.x");
  });

  it("detects OPDS 1.2 when facet links present", () => {
    expect(detectOpdsVersionFromResponse(
      "application/atom+xml",
      '<feed xmlns:opds="http://opds-spec.org/2010/catalog"><opds:facetGroup/></feed>'
    )).toBe("OPDS 1.2");
  });

  it("returns Unknown when nothing matches", () => {
    expect(detectOpdsVersionFromResponse("text/html", "<html></html>")).toBe("Unknown");
  });
});
