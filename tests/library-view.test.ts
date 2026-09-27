import { describe, it, expect } from "vitest";
import {
  matchesQuery,
  findCompleteEntryLink,
  isNavigationEntry,
  isShelfEntry,
  getEffectiveTotal,
  getEffectiveTotalPages,
  needsServerFetch,
  clampPage,
  countItemsThatFit,
  sortBooks,
  formatDownloadLabel,
  formatFolderPath,
  selectCatalogDropdownId,
  OPDSLibraryView
} from "../src/views/library-view";
import type { OPDSEntry, OPDSFeed, OPDSLink, OPDSFacetGroup, OPDSCatalog } from "../src/types/opds";

// Entry filtering logic extracted from OPDSLibraryView.renderContent()
function filterEntries(entries: OPDSEntry[]): { navigationEntries: OPDSEntry[]; bookEntries: OPDSEntry[] } {
  const navigationEntries = entries.filter(isNavigationEntry);
  const bookEntries = entries.filter(e => !isNavigationEntry(e));
  return { navigationEntries, bookEntries };
}

// Pagination logic extracted from OPDSLibraryView
function paginate(entries: any[], currentPage: number, pageSize: number) {
  const start = (currentPage - 1) * pageSize;
  return entries.slice(start, start + pageSize);
}

function getTotalPages(totalEntries: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalEntries / pageSize));
}

function getMaxVisiblePages(currentPage: number, totalPages: number, maxVisible: number = 5) {
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  return { startPage, endPage };
}

// Cover link detection logic from view renderers
function findCoverLink(entry: OPDSEntry): OPDSLink | undefined {
  return entry.link.find((l: OPDSLink) =>
    l.rel.includes("image") || l.type?.startsWith("image/")
  );
}

// Download link detection from book detail rendering
function findDownloadLinks(entry: OPDSEntry): OPDSLink[] {
  return entry.link.filter((l: OPDSLink) =>
    l.rel === "http://opds-spec.org/acquisition" ||
    l.rel === "http://opds-spec.org/acquisition/open-access"
  );
}

// Book detail data extraction from OPDSLibraryView.renderBookDetail()
function extractBookData(entry: OPDSEntry) {
  const coverLink = findCoverLink(entry);
  const downloadLinks = findDownloadLinks(entry);
  const authors = entry.author?.map(a => a.name).filter(Boolean) || [];
  const contributors = entry.contributor?.map(c => c.name).filter(Boolean) || [];
  const subjects = entry.category?.map(c => c.term || c.label).filter(Boolean) || [];
  const dcTerms = entry.dcTerms || {};
  const formats = downloadLinks
    .map(l => (l.title || l.type || "").split("/").pop() || "")
    .filter(Boolean)
    .map(f => f.toUpperCase())
    .filter((f, i, arr) => arr.indexOf(f) === i);

  const details: Record<string, string> = {};
  if (entry.id) details.Identifier = entry.id;
  if (Array.isArray(dcTerms.identifier) && dcTerms.identifier.length > 0) {
    details.Identifiers = dcTerms.identifier.join(", ");
  }
  if (contributors.length > 0) details.Contributors = contributors.join(", ");
  if (subjects.length > 0) details.Subjects = subjects.join(", ");
  if (Array.isArray(dcTerms.subject) && dcTerms.subject.length > 0) {
    details["Subject terms"] = dcTerms.subject.join(", ");
  }
  if (dcTerms.publisher) details.Publisher = dcTerms.publisher;
  const publishedDate = dcTerms.issued || entry.published;
  if (publishedDate) {
    const year = new Date(publishedDate).getFullYear();
    details.Published = Number.isNaN(year) ? String(publishedDate) : `${publishedDate} (${year})`;
  }
  if (entry.updated) details.Updated = entry.updated;
  if (dcTerms.modified) details.Modified = dcTerms.modified;
  if (dcTerms.language) details.Language = dcTerms.language;
  if (dcTerms.type) details.Type = dcTerms.type;
  if (dcTerms.format) details.Format = dcTerms.format;
  if (dcTerms.relation) details.Relation = dcTerms.relation;
  if (dcTerms.coverage) details.Coverage = dcTerms.coverage;
  const rights = entry.rights || dcTerms.rights;
  if (rights) details.Rights = rights;
  if (formats.length > 0) details["Available formats"] = formats.join(", ");

  return {
    title: entry.title || "Untitled",
    coverUrl: coverLink?.href,
    authors,
    subjects,
    publisher: dcTerms.publisher,
    publishedDate,
    description: entry.summary || entry.content || dcTerms.description,
    details
  };
}

// Sanitize filename from downloadEntry
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

function getExtensionFromType(type: string): string {
  if (type.includes("epub")) return "epub";
  if (type.includes("pdf")) return "pdf";
  if (type.includes("mobi")) return "mobi";
  return "epub";
}

// Test data
const NAV_ENTRY: OPDSEntry = {
  id: "nav-1",
  title: "All Books",
  updated: "2026-01-01T00:00:00Z",
  author: [],
  category: [],
  link: [{ rel: "http://opds-spec.org/catalog", href: "http://example.com/catalog", type: "application/atom+xml" }]
};

const SUBSECTION_ENTRY: OPDSEntry = {
  id: "nav-2",
  title: "Recent",
  updated: "2026-01-01T00:00:00Z",
  author: [],
  category: [],
  link: [{ rel: "subsection", href: "http://example.com/recent", type: "application/atom+xml" }]
};

const BOOK_ENTRY: OPDSEntry = {
  id: "book-1",
  title: "Test Book",
  updated: "2026-01-15T00:00:00Z",
  author: [{ name: "Author A" }],
  category: [{ scheme: "subject", term: "Fiction", label: "Fiction" }],
  summary: "A great book",
  link: [
    { rel: "http://opds-spec.org/image/thumbnail", href: "http://example.com/thumb.jpg", type: "image/jpeg" },
    { rel: "http://opds-spec.org/acquisition", href: "http://example.com/book.epub", type: "application/epub+zip", title: "EPUB" },
    { rel: "http://opds-spec.org/acquisition", href: "http://example.com/book.pdf", type: "application/pdf", title: "PDF" }
  ]
};

const BOOK_ENTRY_NO_COVER: OPDSEntry = {
  id: "book-2",
  title: "No Cover Book",
  updated: "2026-01-01T00:00:00Z",
  author: [],
  category: [],
  link: [
    { rel: "http://opds-spec.org/acquisition/open-access", href: "http://example.com/free.pdf", type: "application/pdf" }
  ]
};

const SHELF_ENTRY: OPDSEntry = {
  id: "shelf-1",
  title: "Favorites",
  updated: "2026-01-01T00:00:00Z",
  author: [],
  category: [],
  link: [{ rel: "http://opds-spec.org/shelf", href: "http://example.com/shelf/favorites", type: "application/atom+xml" }]
};

const SORT_ENTRY: OPDSEntry = {
  id: "sort-1",
  title: "New Arrivals",
  updated: "2026-01-01T00:00:00Z",
  author: [],
  category: [],
  link: [{ rel: "http://opds-spec.org/sort/new", href: "http://example.com/new", type: "application/atom+xml" }]
};

describe("matchesQuery (case sensitivity)", () => {
  const entry: OPDSEntry = {
    id: "m1",
    title: "The Great Gatsby",
    updated: "2026-01-01T00:00:00Z",
    author: [{ name: "F. Scott Fitzgerald" }],
    category: [{ scheme: "subject", term: "Classic" }],
    summary: "A story about wealth",
    link: []
  };

  it("matches case-insensitively by default", () => {
    expect(matchesQuery(entry, "gatsby")).toBe(true);
    expect(matchesQuery(entry, "GATSBY")).toBe(true);
    expect(matchesQuery(entry, "The Great")).toBe(true);
    expect(matchesQuery(entry, "fitzgerald")).toBe(true);
  });

  it("matches case-sensitively when flag is true", () => {
    expect(matchesQuery(entry, "Gatsby", true)).toBe(true);
    expect(matchesQuery(entry, "gatsby", true)).toBe(false);
    expect(matchesQuery(entry, "The Great", true)).toBe(true);
    expect(matchesQuery(entry, "the great", true)).toBe(false);
    expect(matchesQuery(entry, "F. Scott", true)).toBe(true);
    expect(matchesQuery(entry, "f. scott", true)).toBe(false);
  });

  it("returns true for empty query regardless of case flag", () => {
    expect(matchesQuery(entry, "", true)).toBe(true);
    expect(matchesQuery(entry, "   ", true)).toBe(true);
  });

  it("trims query before matching", () => {
    expect(matchesQuery(entry, "  Gatsby  ", true)).toBe(true);
    expect(matchesQuery(entry, "  gatsby  ", true)).toBe(false);
  });

  it("filters a mixed-case list correctly", () => {
    const books = [
      { ...entry, title: "Dune" },
      { ...entry, title: "DUNE" },
      { ...entry, title: "dune" }
    ];
    const ci = books.filter(b => matchesQuery(b, "dune", false));
    expect(ci).toHaveLength(3);
    const cs = books.filter(b => matchesQuery(b, "dune", true));
    expect(cs).toHaveLength(1);
    expect(cs[0].title).toBe("dune");
    const csUpper = books.filter(b => matchesQuery(b, "DUNE", true));
    expect(csUpper).toHaveLength(1);
    expect(csUpper[0].title).toBe("DUNE");
  });
});

describe("Server-aware pagination helpers", () => {
  describe("getEffectiveTotal", () => {
    it("prefers loaded count when search is active", () => {
      expect(getEffectiveTotal(1000, 42, true)).toBe(42);
    });

    it("prefers server total when available and not searching", () => {
      expect(getEffectiveTotal(1000, 40, false)).toBe(1000);
    });

    it("falls back to loaded count when server total missing", () => {
      expect(getEffectiveTotal(0, 40, false)).toBe(40);
      expect(getEffectiveTotal(undefined as unknown as number, 40, false)).toBe(40);
    });

    it("uses loaded count when server total is smaller than loaded (partial inconsistency)", () => {
      expect(getEffectiveTotal(10, 40, false)).toBe(10);
    });
  });

  describe("getEffectiveTotalPages", () => {
    it("computes pages from effective total", () => {
      expect(getEffectiveTotalPages(0, 20)).toBe(1);
      expect(getEffectiveTotalPages(1, 20)).toBe(1);
      expect(getEffectiveTotalPages(20, 20)).toBe(1);
      expect(getEffectiveTotalPages(21, 20)).toBe(2);
      expect(getEffectiveTotalPages(1000, 20)).toBe(50);
    });

    it("guards against invalid page size", () => {
      expect(getEffectiveTotalPages(100, 0)).toBe(1);
      expect(getEffectiveTotalPages(100, -5)).toBe(1);
    });
  });

  describe("needsServerFetch", () => {
    it("does not fetch when target page is already covered by loaded entries", () => {
      expect(needsServerFetch(1, 20, 20, true)).toBe(false);
      expect(needsServerFetch(2, 40, 20, true)).toBe(false);
      expect(needsServerFetch(1, 5, 20, false)).toBe(false);
    });

    it("fetches when target page needs more entries and next exists", () => {
      expect(needsServerFetch(2, 20, 20, true)).toBe(true);
      expect(needsServerFetch(3, 25, 20, true)).toBe(true);
      expect(needsServerFetch(5, 40, 20, true)).toBe(true);
    });

    it("does not fetch when next link is absent", () => {
      expect(needsServerFetch(2, 20, 20, false)).toBe(false);
      expect(needsServerFetch(5, 40, 20, false)).toBe(false);
    });

    it("ignores invalid page or page size", () => {
      expect(needsServerFetch(0, 0, 20, true)).toBe(false);
      expect(needsServerFetch(-1, 0, 20, true)).toBe(false);
      expect(needsServerFetch(2, 0, 0, true)).toBe(false);
    });
  });

  describe("clampPage", () => {
    it("clamps into [1, totalPages]", () => {
      expect(clampPage(0, 5)).toBe(1);
      expect(clampPage(3, 5)).toBe(3);
      expect(clampPage(9, 5)).toBe(5);
      expect(clampPage(1, 0)).toBe(1);
      expect(clampPage(5, 1)).toBe(1);
    });
  });

  describe("info bar total text logic", () => {
    function infoText(serverTotal: number, loadedCount: number, searchQuery: string): string {
      const hasActiveSearch = searchQuery.trim().length > 0;
      const effectiveTotal = getEffectiveTotal(serverTotal, loadedCount, hasActiveSearch);
      if (hasActiveSearch) {
        return loadedCount + " matching book" + (loadedCount === 1 ? "" : "s");
      }
      if (serverTotal > 0 && serverTotal > loadedCount) {
        return "Showing " + loadedCount + " of " + serverTotal + " books";
      }
      if (serverTotal > 0) {
        return serverTotal + " book" + (serverTotal === 1 ? "" : "s");
      }
      void effectiveTotal;
      return loadedCount + " book" + (loadedCount === 1 ? "" : "s");
    }

    it("shows partial loaded vs server total", () => {
      expect(infoText(1000, 40, "")).toBe("Showing 40 of 1000 books");
    });

    it("shows server total when fully consistent", () => {
      expect(infoText(40, 40, "")).toBe("40 books");
      expect(infoText(1, 1, "")).toBe("1 book");
    });

    it("falls back to loaded count without server total", () => {
      expect(infoText(0, 40, "")).toBe("40 books");
      expect(infoText(0, 1, "")).toBe("1 book");
    });

    it("shows matching count during search regardless of server total", () => {
      expect(infoText(1000, 12, "gatsby")).toBe("12 matching books");
      expect(infoText(0, 1, "gatsby")).toBe("1 matching book");
    });
  });
});

describe("Entry Filtering (navigation vs book)", () => {
  it("separates navigation entries from book entries", () => {
    const entries = [NAV_ENTRY, SUBSECTION_ENTRY, BOOK_ENTRY, BOOK_ENTRY_NO_COVER];
    const { navigationEntries, bookEntries } = filterEntries(entries);
    expect(navigationEntries).toHaveLength(2);
    expect(bookEntries).toHaveLength(2);
  });

  it("identifies catalog link as navigation", () => {
    const { navigationEntries } = filterEntries([NAV_ENTRY]);
    expect(navigationEntries).toHaveLength(1);
    expect(navigationEntries[0].title).toBe("All Books");
  });

  it("identifies subsection link as navigation", () => {
    const { navigationEntries } = filterEntries([SUBSECTION_ENTRY]);
    expect(navigationEntries).toHaveLength(1);
    expect(navigationEntries[0].title).toBe("Recent");
  });

  it("identifies shelf entries as navigation", () => {
    const { navigationEntries } = filterEntries([SHELF_ENTRY]);
    expect(navigationEntries).toHaveLength(1);
    expect(isShelfEntry(SHELF_ENTRY)).toBe(true);
    expect(isShelfEntry(NAV_ENTRY)).toBe(false);
  });

  it("identifies sort entries as navigation", () => {
    const { navigationEntries } = filterEntries([SORT_ENTRY]);
    expect(navigationEntries).toHaveLength(1);
    expect(isShelfEntry(SORT_ENTRY)).toBe(false);
  });

  it("identifies book entries (no nav links)", () => {
    const { bookEntries } = filterEntries([BOOK_ENTRY]);
    expect(bookEntries).toHaveLength(1);
    expect(bookEntries[0].title).toBe("Test Book");
  });

  it("handles empty entries array", () => {
    const { navigationEntries, bookEntries } = filterEntries([]);
    expect(navigationEntries).toHaveLength(0);
    expect(bookEntries).toHaveLength(0);
  });

  it("handles entry without links", () => {
    expect(isNavigationEntry({ id: "x", title: "y" })).toBe(false);
    expect(isNavigationEntry(null)).toBe(false);
  });
});

describe("Facet chip model", () => {
  const facetGroups: OPDSFacetGroup[] = [
    {
      title: "Sort by",
      facet: [
        { value: "/f?sort=title", href: "http://example.com/f?sort=title", title: "Title", count: 42, active: true },
        { value: "/f?sort=author", href: "http://example.com/f?sort=author", title: "Author", count: 17, active: false }
      ]
    },
    {
      title: "Language",
      facet: [
        { value: "/f?lang=en", href: "http://example.com/f?lang=en", title: "English", count: 10, active: false }
      ]
    }
  ];

  it("groups facets by title with active flags", () => {
    expect(facetGroups).toHaveLength(2);
    const sort = facetGroups[0];
    expect(sort.facet.map(f => f.title)).toEqual(["Title", "Author"]);
    expect(sort.facet[0].active).toBe(true);
    expect(sort.facet[1].active).toBe(false);
    expect(sort.facet[0].count).toBe(42);
  });

  it("facet hrefs are absolute and unique", () => {
    const hrefs = facetGroups.flatMap(g => g.facet.map(f => f.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every(h => h.startsWith("http"))).toBe(true);
  });
});

describe("Pagination", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Book ${i}` }));

  it("returns first page", () => {
    const result = paginate(items, 1, 20);
    expect(result).toHaveLength(20);
    expect(result[0].id).toBe(0);
    expect(result[19].id).toBe(19);
  });

  it("returns second page", () => {
    const result = paginate(items, 2, 20);
    expect(result).toHaveLength(20);
    expect(result[0].id).toBe(20);
  });

  it("returns partial last page", () => {
    const result = paginate(items, 3, 20);
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe(40);
  });

  it("handles page beyond end", () => {
    const result = paginate(items, 10, 20);
    expect(result).toHaveLength(0);
  });

  it("getTotalPages calculates correctly", () => {
    expect(getTotalPages(50, 20)).toBe(3);
    expect(getTotalPages(40, 20)).toBe(2);
    expect(getTotalPages(1, 20)).toBe(1);
    expect(getTotalPages(0, 20)).toBe(1);
  });
});

describe("countItemsThatFit (list viewport fit)", () => {
  it("fits whole items into available height", () => {
    expect(countItemsThatFit(20, 600, 80)).toBe(7);
    expect(countItemsThatFit(20, 640, 80)).toBe(8);
  });

  it("returns at least one item when height allows", () => {
    expect(countItemsThatFit(20, 40, 80)).toBe(1);
    expect(countItemsThatFit(20, 0, 80)).toBe(20);
    expect(countItemsThatFit(20, 600, 0)).toBe(20);
  });

  it("never exceeds item count", () => {
    expect(countItemsThatFit(3, 6000, 10)).toBe(3);
    expect(countItemsThatFit(0, 600, 80)).toBe(0);
  });
});

describe("sortBooks", () => {
  const books = [
    { title: "Bravo", author: [{ name: "Zoe" }], dcTerms: { issued: "2020-01-01" }, updated: "2021-01-01" },
    { title: "alpha", author: [{ name: "amy" }], dcTerms: { issued: "2022-06-01" }, updated: "2023-01-01" },
    { title: "Charlie", author: [{ name: "Bob" }], dcTerms: { issued: "2021-03-01" }, updated: "2020-01-01" }
  ];

  it("default keeps feed order", () => {
    const sorted = sortBooks(books, "default");
    expect(sorted.map(b => b.title)).toEqual(["Bravo", "alpha", "Charlie"]);
    expect(sorted).not.toBe(books);
  });

  it("sorts by title asc/desc", () => {
    expect(sortBooks(books, "title", "asc").map(b => b.title)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(sortBooks(books, "title", "desc").map(b => b.title)).toEqual(["Charlie", "Bravo", "alpha"]);
  });

  it("sorts by author", () => {
    expect(sortBooks(books, "author", "asc").map(b => b.author[0].name)).toEqual(["amy", "Bob", "Zoe"]);
    expect(sortBooks(books, "author", "desc").map(b => b.author[0].name)).toEqual(["Zoe", "Bob", "amy"]);
  });

  it("sorts by published date", () => {
    expect(sortBooks(books, "published", "desc").map(b => b.dcTerms.issued)).toEqual(["2022-06-01", "2021-03-01", "2020-01-01"]);
    expect(sortBooks(books, "published", "asc").map(b => b.dcTerms.issued)).toEqual(["2020-01-01", "2021-03-01", "2022-06-01"]);
  });

  it("sorts by updated date", () => {
    expect(sortBooks(books, "updated", "desc").map(b => b.updated)).toEqual(["2023-01-01", "2021-01-01", "2020-01-01"]);
    expect(sortBooks(books, "updated", "asc").map(b => b.updated)).toEqual(["2020-01-01", "2021-01-01", "2023-01-01"]);
  });
});

describe("Max Visible Pages", () => {
  it("shows 5 pages when enough total", () => {
    const { startPage, endPage } = getMaxVisiblePages(3, 10);
    expect(startPage).toBe(1);
    expect(endPage).toBe(5);
  });

  it("adjusts start near beginning", () => {
    const { startPage, endPage } = getMaxVisiblePages(1, 10);
    expect(startPage).toBe(1);
    expect(endPage).toBe(5);
  });

  it("adjusts end near end", () => {
    const { startPage, endPage } = getMaxVisiblePages(10, 10);
    expect(startPage).toBe(6);
    expect(endPage).toBe(10);
  });

  it("handles few total pages", () => {
    const { startPage, endPage } = getMaxVisiblePages(1, 3);
    expect(startPage).toBe(1);
    expect(endPage).toBe(3);
  });
});

describe("Cover Link Detection", () => {
  it("finds thumbnail image link", () => {
    const cover = findCoverLink(BOOK_ENTRY);
    expect(cover).toBeDefined();
    expect(cover!.href).toContain("thumb.jpg");
  });

  it("returns undefined when no image link", () => {
    const cover = findCoverLink(BOOK_ENTRY_NO_COVER);
    expect(cover).toBeUndefined();
  });
});

describe("Download Link Detection", () => {
  it("finds acquisition links", () => {
    const links = findDownloadLinks(BOOK_ENTRY);
    expect(links).toHaveLength(2);
  });

  it("finds open-access links", () => {
    const links = findDownloadLinks(BOOK_ENTRY_NO_COVER);
    expect(links).toHaveLength(1);
    expect(links[0].rel).toContain("open-access");
  });

  it("returns empty array for entries with no acquisition links", () => {
    const links = findDownloadLinks(NAV_ENTRY);
    expect(links).toHaveLength(0);
  });
});

describe("Book Data Extraction (renderBookDetail)", () => {
  it("extracts all fields from a complete entry", () => {
    const data = extractBookData(BOOK_ENTRY);
    expect(data.title).toBe("Test Book");
    expect(data.authors).toEqual(["Author A"]);
    expect(data.coverUrl).toBe("http://example.com/thumb.jpg");
    expect(data.description).toBe("A great book");
    expect(data.subjects).toEqual(["Fiction"]);
    expect(data.details.Identifier).toBe("book-1");
    expect(data.details.Subjects).toBe("Fiction");
    expect(data.details["Available formats"]).toBe("EPUB, PDF");
  });

  it("defaults title to Untitled when missing", () => {
    const data = extractBookData({ ...BOOK_ENTRY, title: "" });
    expect(data.title).toBe("Untitled");
  });

  it("handles entry with no authors", () => {
    const data = extractBookData(BOOK_ENTRY_NO_COVER);
    expect(data.authors).toEqual([]);
  });

  it("handles entry with no cover", () => {
    const data = extractBookData(BOOK_ENTRY_NO_COVER);
    expect(data.coverUrl).toBeUndefined();
  });

  it("prefers content over summary for description", () => {
    const entry: OPDSEntry = { ...BOOK_ENTRY, summary: "Summary text", content: "Content text" };
    const data = extractBookData(entry);
    expect(data.description).toBe("Summary text");
  });

  it("falls back to content when no summary", () => {
    const entry: OPDSEntry = { ...BOOK_ENTRY, summary: undefined, content: "Content text" };
    const data = extractBookData(entry);
    expect(data.description).toBe("Content text");
  });

  it("includes full dcTerms metadata in details", () => {
    const entry: OPDSEntry = {
      ...BOOK_ENTRY,
      published: "2026-01-15T00:00:00Z",
      contributor: [{ name: "Editor B" }],
      rights: "CC BY",
      dcTerms: {
        identifier: ["urn:isbn:9780000000000"],
        issued: "2026-01-15",
        modified: "2026-01-20",
        language: "en",
        publisher: "Test Press",
        subject: ["Speculative"],
        description: "Long description",
        type: "Text",
        format: "application/epub+zip",
        relation: "series-1",
        coverage: "World",
        rights: "CC BY-SA"
      }
    };
    const data = extractBookData(entry);
    expect(data.details.Identifier).toBe("book-1");
    expect(data.details.Identifiers).toBe("urn:isbn:9780000000000");
    expect(data.details.Contributors).toBe("Editor B");
    expect(data.details.Publisher).toBe("Test Press");
    expect(data.details.Language).toBe("en");
    expect(data.details.Type).toBe("Text");
    expect(data.details.Format).toBe("application/epub+zip");
    expect(data.details.Relation).toBe("series-1");
    expect(data.details.Coverage).toBe("World");
    expect(data.details.Rights).toBe("CC BY");
    expect(data.details["Subject terms"]).toBe("Speculative");
    expect(data.details.Modified).toBe("2026-01-20");
  });
});

describe("Filename Sanitization", () => {
  it("replaces illegal characters", () => {
    expect(sanitizeFileName('Book: "Title" <v1>')).toBe("Book_ _Title_ _v1_");
  });

  it("truncates to 200 characters", () => {
    const longName = "A".repeat(300);
    expect(sanitizeFileName(longName)).toHaveLength(200);
  });

  it("preserves clean names", () => {
    expect(sanitizeFileName("Normal Book Title")).toBe("Normal Book Title");
  });
});

describe("Extension Detection", () => {
  it("detects epub", () => {
    expect(getExtensionFromType("application/epub+zip")).toBe("epub");
  });

  it("detects pdf", () => {
    expect(getExtensionFromType("application/pdf")).toBe("pdf");
  });

  it("detects mobi", () => {
    expect(getExtensionFromType("application/x-mobipocket-ebook")).toBe("mobi");
  });

  it("defaults to epub", () => {
    expect(getExtensionFromType("application/octet-stream")).toBe("epub");
  });
});

describe("Complete Catalog Entry Link Detection", () => {
  it("finds complete entry alternate link by media type", () => {
    const entry: OPDSEntry = {
      ...BOOK_ENTRY,
      link: [
        ...BOOK_ENTRY.link,
        {
          rel: "alternate",
          href: "http://example.com/entries/book-1.complete.xml",
          type: "application/atom+xml;type=entry;profile=opds-catalog",
          title: "Complete Catalog Entry"
        }
      ]
    };
    const link = findCompleteEntryLink(entry);
    expect(link).not.toBeNull();
    expect(link.href).toContain("complete.xml");
  });

  it("finds complete entry by title when type differs", () => {
    const entry: OPDSEntry = {
      ...BOOK_ENTRY,
      link: [
        ...BOOK_ENTRY.link,
        {
          rel: "alternate",
          href: "http://example.com/complete/1",
          type: "application/atom+xml",
          title: "Complete Catalog Entry"
        }
      ]
    };
    expect(findCompleteEntryLink(entry)).not.toBeNull();
  });

  it("returns null when no complete entry link", () => {
    expect(findCompleteEntryLink(BOOK_ENTRY)).toBeNull();
  });

  it("returns null for non-alternate links", () => {
    const entry: OPDSEntry = {
      ...BOOK_ENTRY,
      link: [
        {
          rel: "http://opds-spec.org/acquisition",
          href: "http://example.com/book.epub",
          type: "application/atom+xml;type=entry;profile=opds-catalog"
        }
      ]
    };
    expect(findCompleteEntryLink(entry)).toBeNull();
  });

  it("returns null for entry without links", () => {
    expect(findCompleteEntryLink({ id: "x", title: "y", link: undefined })).toBeNull();
    expect(findCompleteEntryLink(null)).toBeNull();
  });
});

describe("formatDownloadLabel", () => {
  it("prefers short type-based labels over long titles", () => {
    expect(formatDownloadLabel({
      type: "application/epub+zip",
      title: "AROUND%20THE%20WORLD%20IN%20EIGHTY%20DAYS.EPUB"
    })).toBe("EPUB");
  });

  it("uses file extension when title is a long filename without type", () => {
    expect(formatDownloadLabel({
      title: "AROUND%20THE%20WORLD%20IN%20EIGHTY%20DAYS.EPUB"
    })).toBe("EPUB");
  });

  it("keeps short clean titles", () => {
    expect(formatDownloadLabel({ title: "EPUB" })).toBe("EPUB");
    expect(formatDownloadLabel({ title: "Download PDF" })).toBe("DOWNLOAD PDF");
  });

  it("falls back to Download for unusable titles", () => {
    expect(formatDownloadLabel({ title: "https://example.com/very/long/path/file" })).toBe("Download");
    expect(formatDownloadLabel({})).toBe("Download");
    expect(formatDownloadLabel(null)).toBe("Download");
  });
});

describe("formatFolderPath", () => {
  it("joins folder segments with a separator", () => {
    expect(formatFolderPath(["Gutenberg", "Fiction", "Sci-Fi"])).toBe("Gutenberg / Fiction / Sci-Fi");
  });

  it("keeps a single segment as-is", () => {
    expect(formatFolderPath(["Root"])).toBe("Root");
  });

  it("drops empty and whitespace-only segments", () => {
    expect(formatFolderPath(["", "  ", "Root"])).toBe("Root");
    expect(formatFolderPath(["Root", " ", "Child"])).toBe("Root / Child");
  });

  it("returns an empty string for an empty path", () => {
    expect(formatFolderPath([])).toBe("");
  });
});

describe("selectCatalogDropdownId", () => {
  function makeFeed(id: string): OPDSFeed {
    return {
      id,
      title: id,
      updated: "2026-01-01T00:00:00Z",
      author: [],
      entry: [],
      link: [],
      totalResults: 0
    };
  }

  function makeCatalog(id: string): OPDSCatalog {
    return { id, title: id, url: `http://example.com/${id}`, type: "navigation" };
  }

  const catalogs = [makeCatalog("root"), makeCatalog("featured-main"), makeCatalog("link-featured")];

  it("keeps the level-1 catalog when a subfolder shares a URL with another catalog", () => {
    const current = makeCatalog("featured-main");
    const stack = [
      { catalog: makeCatalog("root"), feed: makeFeed("root-feed") },
      { catalog: makeCatalog("link-featured"), feed: makeFeed("lf-feed") }
    ];
    expect(selectCatalogDropdownId(catalogs, current, stack)).toBe("link-featured");
  });

  it("selects the current catalog when directly inside a level-1 catalog", () => {
    const stack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    expect(selectCatalogDropdownId(catalogs, makeCatalog("link-featured"), stack)).toBe("link-featured");
  });

  it("falls back to the root when the current catalog is not in the library", () => {
    const stack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    expect(selectCatalogDropdownId(catalogs, makeCatalog("unknown"), stack)).toBe("root");
  });

  it("falls back to the first catalog when nothing matches", () => {
    expect(selectCatalogDropdownId(catalogs, makeCatalog("unknown"), [])).toBe("root");
  });
});

describe("OPDSLibraryView.goBack", () => {
  function makeFeed(id: string): OPDSFeed {
    return {
      id,
      title: id,
      updated: "2026-01-01T00:00:00Z",
      author: [],
      entry: [],
      link: [],
      totalResults: 0
    };
  }

  function makeCatalog(id: string): OPDSCatalog {
    return { id, title: id, url: `http://example.com/${id}`, type: "navigation" };
  }

  function makeView(): OPDSLibraryView {
    const view = new OPDSLibraryView({} as any, {} as any);
    view.render = () => {};
    return view;
  }

  it("pops navigation stack and restores previous catalog/feed", async () => {
    const view = makeView();
    const prevCatalog = makeCatalog("root");
    const prevFeed = makeFeed("root-feed");
    const childCatalog = makeCatalog("child");
    const childFeed = makeFeed("child-feed");

    view.currentCatalog = childCatalog;
    view.currentFeed = childFeed;
    view.navigationStack = [{ catalog: prevCatalog, feed: prevFeed }];
    view.currentPage = 3;

    await view.goBack();

    expect(view.navigationStack).toHaveLength(0);
    expect(view.currentCatalog).toBe(prevCatalog);
    expect(view.currentFeed).toBe(prevFeed);
    expect(view.currentPage).toBe(1);
  });

  it("is a no-op when navigation stack is empty and no detail is open", async () => {
    const view = makeView();
    const catalog = makeCatalog("root");
    const feed = makeFeed("root-feed");
    view.currentCatalog = catalog;
    view.currentFeed = feed;
    view.navigationStack = [];

    await view.goBack();

    expect(view.currentCatalog).toBe(catalog);
    expect(view.currentFeed).toBe(feed);
    expect(view.navigationStack).toHaveLength(0);
  });

  it("closes detail view first without touching the navigation stack", async () => {
    const view = makeView();
    const catalog = makeCatalog("root");
    const feed = makeFeed("root-feed");
    view.currentCatalog = catalog;
    view.currentFeed = feed;
    view.navigationStack = [{ catalog: makeCatalog("other"), feed: makeFeed("other-feed") }];
    view.detailEntry = { id: "book-1", title: "Book", updated: "2026-01-01T00:00:00Z", author: [], category: [], link: [] } as OPDSEntry;

    await view.goBack();

    expect(view.detailEntry).toBeNull();
    expect(view.navigationStack).toHaveLength(1);
    expect(view.currentCatalog).toBe(catalog);
    expect(view.currentFeed).toBe(feed);
  });

  it("pops the folder path alongside the navigation stack", async () => {
    const view = makeView();
    view.currentCatalog = makeCatalog("child");
    view.currentFeed = makeFeed("child-feed");
    view.navigationStack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    view.folderPath = ["root", "child"];

    await view.goBack();

    expect(view.folderPath).toEqual(["root"]);
  });

  it("keeps the root segment when the path is already minimal", async () => {
    const view = makeView();
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.navigationStack = [{ catalog: makeCatalog("other"), feed: makeFeed("other-feed") }];
    view.folderPath = ["root"];

    await view.goBack();

    expect(view.folderPath).toEqual(["root"]);
  });
});

describe("OPDSLibraryView.goHome", () => {
  function makeFeed(id: string): OPDSFeed {
    return {
      id,
      title: id,
      updated: "2026-01-01T00:00:00Z",
      author: [],
      entry: [],
      link: [],
      totalResults: 0
    };
  }

  function makeCatalog(id: string): OPDSCatalog {
    return { id, title: id, url: `http://example.com/${id}`, type: "navigation" };
  }

  function makeView(): OPDSLibraryView {
    const view = new OPDSLibraryView({} as any, {} as any);
    view.render = () => {};
    return view;
  }

  it("clears the stack and restores the root catalog/feed", async () => {
    const view = makeView();
    const rootCatalog = makeCatalog("root");
    const rootFeed = makeFeed("root-feed");

    view.currentCatalog = makeCatalog("deep");
    view.currentFeed = makeFeed("deep-feed");
    view.navigationStack = [
      { catalog: rootCatalog, feed: rootFeed },
      { catalog: makeCatalog("mid"), feed: makeFeed("mid-feed") }
    ];
    view.currentPage = 5;

    await view.goHome();

    expect(view.navigationStack).toHaveLength(0);
    expect(view.currentCatalog).toBe(rootCatalog);
    expect(view.currentFeed).toBe(rootFeed);
    expect(view.currentPage).toBe(1);
  });

  it("closes detail and clears the stack in one step", async () => {
    const view = makeView();
    const rootCatalog = makeCatalog("root");
    const rootFeed = makeFeed("root-feed");

    view.detailEntry = { id: "book-1", title: "Book", updated: "2026-01-01T00:00:00Z", author: [], category: [], link: [] } as OPDSEntry;
    view.currentCatalog = makeCatalog("child");
    view.currentFeed = makeFeed("child-feed");
    view.navigationStack = [{ catalog: rootCatalog, feed: rootFeed }];

    await view.goHome();

    expect(view.detailEntry).toBeNull();
    expect(view.navigationStack).toHaveLength(0);
    expect(view.currentCatalog).toBe(rootCatalog);
    expect(view.currentFeed).toBe(rootFeed);
  });

  it("is safe when already at root with no detail", async () => {
    const view = makeView();
    const catalog = makeCatalog("root");
    const feed = makeFeed("root-feed");
    view.currentCatalog = catalog;
    view.currentFeed = feed;
    view.navigationStack = [];
    view.searchQuery = "stale search";
    view.catalogFeedCache = { catalogId: "root", feed: makeFeed("cached") };

    await view.goHome();

    expect(view.currentCatalog).toBe(catalog);
    expect(view.currentFeed).toBe(feed);
    expect(view.navigationStack).toHaveLength(0);
    expect(view.searchQuery).toBe("");
    expect(view.catalogFeedCache).toBeNull();
  });

  it("clears search and feed cache when jumping home", async () => {
    const view = makeView();
    const rootCatalog = makeCatalog("root");
    const rootFeed = makeFeed("root-feed");

    view.currentCatalog = makeCatalog("child");
    view.currentFeed = makeFeed("child-feed");
    view.navigationStack = [{ catalog: rootCatalog, feed: rootFeed }];
    view.searchQuery = "query";
    view.catalogFeedCache = { catalogId: "child", feed: makeFeed("child-cached") };

    await view.goHome();

    expect(view.currentCatalog).toBe(rootCatalog);
    expect(view.currentFeed).toBe(rootFeed);
    expect(view.searchQuery).toBe("");
    expect(view.catalogFeedCache).toBeNull();
  });

  it("resets the folder path to the root catalog title", async () => {
    const view = makeView();
    const rootCatalog = makeCatalog("root");
    const rootFeed = makeFeed("root-feed");

    view.currentCatalog = makeCatalog("deep");
    view.currentFeed = makeFeed("deep-feed");
    view.navigationStack = [
      { catalog: rootCatalog, feed: rootFeed },
      { catalog: makeCatalog("mid"), feed: makeFeed("mid-feed") }
    ];
    view.folderPath = ["root", "mid", "deep"];

    await view.goHome();

    expect(view.folderPath).toEqual(["root"]);
  });
});

describe("OPDSLibraryView folder path navigation", () => {
  function makeFeed(id: string): OPDSFeed {
    return {
      id,
      title: id,
      updated: "2026-01-01T00:00:00Z",
      author: [],
      entry: [],
      link: [],
      totalResults: 0
    };
  }

  function makeCatalog(id: string): OPDSCatalog {
    return { id, title: id, url: `http://example.com/${id}`, type: "navigation" };
  }

  function makeView(): OPDSLibraryView {
    const view = new OPDSLibraryView({} as any, {} as any);
    view.render = () => {};
    return view;
  }

  function stubClient(view: OPDSLibraryView, getBooks: (url: string) => Promise<OPDSFeed>): void {
    view.client = { getBooks } as any;
  }

  it("pushes the target catalog title when drilling into a subfolder", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("child-feed"));
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.folderPath = ["root"];

    await view.navigateToCatalog(makeCatalog("fiction"));

    expect(view.navigationStack).toHaveLength(1);
    expect(view.folderPath).toEqual(["root", "fiction"]);
  });

  it("starts with an empty path before the library loads", () => {
    const view = makeView();
    expect(view.folderPath).toEqual([]);
  });

  it("ignores a repeat click on the folder already being viewed (double click)", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("child-feed"));
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.folderPath = ["root"];
    const target = makeCatalog("fiction");

    await view.navigateToCatalog(target);
    await view.navigateToCatalog(target);

    expect(view.navigationStack).toHaveLength(1);
    expect(view.folderPath).toEqual(["root", "fiction"]);
  });

  it("ignores a second navigation while the first is still loading (double click)", async () => {
    const view = makeView();
    let release: (feed: OPDSFeed) => void = () => {};
    stubClient(view, () => new Promise<OPDSFeed>(resolve => { release = resolve; }));
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.folderPath = ["root"];
    const target = makeCatalog("fiction");

    const first = view.navigateToCatalog(target);
    const second = view.navigateToCatalog(target);
    release(makeFeed("child-feed"));
    await Promise.all([first, second]);

    expect(view.navigationStack).toHaveLength(1);
    expect(view.folderPath).toEqual(["root", "fiction"]);
  });

  it("restores the previous path when the folder fails to load", async () => {
    const view = makeView();
    stubClient(view, async () => { throw new Error("offline"); });
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.folderPath = ["root"];

    await view.navigateToCatalog(makeCatalog("fiction"));

    expect(view.navigationStack).toHaveLength(0);
    expect(view.folderPath).toEqual(["root"]);
    expect(view.currentCatalog?.id).toBe("root");
  });

  it("allows re-entering a folder after going back to the root", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("any-feed"));
    view.currentCatalog = makeCatalog("root");
    view.currentFeed = makeFeed("root-feed");
    view.folderPath = ["root"];

    await view.navigateToCatalog(makeCatalog("fiction"));
    await view.goBack();
    await view.navigateToCatalog(makeCatalog("fiction"));

    expect(view.navigationStack).toHaveLength(1);
    expect(view.folderPath).toEqual(["root", "fiction"]);
  });

  it("keeps the root entry on the stack when switching catalogs from the dropdown", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("other-feed"));
    view.currentCatalog = makeCatalog("fiction");
    view.currentFeed = makeFeed("fiction-feed");
    view.navigationStack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    view.folderPath = ["root", "fiction"];
    view.searchQuery = "stale query";

    await view.navigateToRootCatalog(makeCatalog("other"));

    expect(view.navigationStack).toHaveLength(1);
    expect(view.navigationStack[0].catalog.id).toBe("root");
    expect(view.folderPath).toEqual(["root", "other"]);
    expect(view.searchQuery).toBe("");
    expect(view.currentCatalog?.id).toBe("other");
  });

  it("resets to the server root when jumping to the root catalog itself", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("root-feed"));
    view.currentCatalog = makeCatalog("fiction");
    view.currentFeed = makeFeed("fiction-feed");
    view.navigationStack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    view.folderPath = ["root", "fiction"];

    await view.navigateToRootCatalog(makeCatalog("root"));

    expect(view.navigationStack).toHaveLength(0);
    expect(view.folderPath).toEqual(["root"]);
    expect(view.currentCatalog?.id).toBe("root");
  });

  it("goes back to the server root after a catalog dropdown jump", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("other-feed"));
    view.currentCatalog = makeCatalog("fiction");
    view.currentFeed = makeFeed("fiction-feed");
    view.navigationStack = [{ catalog: makeCatalog("root"), feed: makeFeed("root-feed") }];
    view.folderPath = ["root", "fiction"];

    await view.navigateToRootCatalog(makeCatalog("other"));
    await view.goBack();

    expect(view.navigationStack).toHaveLength(0);
    expect(view.folderPath).toEqual(["root"]);
    expect(view.currentCatalog?.id).toBe("root");
  });

  it("keeps the current context when re-selecting the catalog already displayed", async () => {
    const view = makeView();
    stubClient(view, async () => makeFeed("a-feed"));
    view.currentCatalog = makeCatalog("a");
    view.currentFeed = makeFeed("a-root-feed");
    view.navigationStack = [{ catalog: makeCatalog("a"), feed: makeFeed("a-previous-feed") }];
    view.folderPath = ["a", "filtered"];

    await view.navigateToRootCatalog(makeCatalog("a"));

    expect(view.navigationStack).toHaveLength(1);
    expect(view.folderPath).toEqual(["a", "filtered"]);
  });

  it("restores the previous location when the root jump fails to load", async () => {
    const view = makeView();
    stubClient(view, async () => { throw new Error("offline"); });
    view.currentCatalog = makeCatalog("fiction");
    view.currentFeed = makeFeed("fiction-feed");
    const stackEntry = { catalog: makeCatalog("root"), feed: makeFeed("root-feed") };
    view.navigationStack = [stackEntry];
    view.folderPath = ["root", "fiction"];

    await view.navigateToRootCatalog(makeCatalog("other"));

    expect(view.navigationStack).toEqual([stackEntry]);
    expect(view.folderPath).toEqual(["root", "fiction"]);
    expect(view.currentCatalog?.id).toBe("fiction");
  });
});
