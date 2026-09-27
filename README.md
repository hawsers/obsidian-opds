# OPDS Client for Obsidian

Browse, search, and download books from [OPDS](https://opds-spec.org/) catalogs inside Obsidian.

## Features

- Multiple OPDS servers with **none / basic / bearer / OAuth2 (client credentials)** auth
- Library navigation with breadcrumbs, shelves, and facet filters
- Book search (optional case-sensitive match) and sort-by options
- Server totals + unified pagination (auto-fetches next OPDS pages)
- Download EPUB / PDF / MOBI into a vault folder

## Usage

Requires Obsidian **1.5.0+**. Once the plugin is enabled:

1. Open the library via the ribbon icon (book), the command **Open OPDS Library**, or the command **Search Books** — both open the `opds-library-view` sidebar.
2. Pick a server, then browse catalogs with breadcrumb-style back navigation. Server totals and pagination are handled automatically (next OPDS pages are fetched for you).
3. Type in the search box to search the current catalog (debounced; optional case-sensitive match) and use the sort options to reorder results.
4. Click a book to open the detail view (`opds-book-detail-view`) with cover, metadata, and available formats.
5. Download a book into your vault folder (default `Books`) in your preferred format (EPUB, PDF, MOBI).

| Command | Description |
|---------|-------------|
| `Open OPDS Library` | Open the OPDS library sidebar |
| `Search Books` | Open the library (same as above) |

## Configuration

All settings live in *Settings → OPDS Client*.

### OPDS servers

On first launch the plugin seeds two free public catalogs (Project Gutenberg, Feedbooks Test Catalog). They are ordinary servers — edit or delete them like any other. Use **+ Add OPDS Server** to create your own.

Each server card shows its name, URL, auth type, last refresh status (catalog count / error message), and the detected OPDS version, with these actions:

| Action | Description |
|--------|-------------|
| **Refresh** | Fetch the root feed, detect the OPDS version, and store a status message |
| **Activate** | Make this the server shown in the library sidebar (active card is highlighted) |
| **Edit** | Change name, URL, or authentication in the server modal |
| **Delete** | Remove the server (asks for confirmation; the active-server index is adjusted automatically) |

The server URL must include the protocol (e.g. `https://example.com/opds`); invalid URLs are rejected when saving.

### Authentication

Pick the auth type in the server modal — the relevant fields appear automatically:

| Auth type | Fields |
|-----------|--------|
| **None** | — (public catalogs) |
| **Basic** | Username, password |
| **Bearer Token** | Token |
| **OAuth2** (client credentials) | Token URL, Client ID, Client Secret, Scope (optional). Token URL defaults to *Server URL* + `/token` when left blank |

### General settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Download folder** | Where downloaded books are saved, relative to the vault root | `Books` |
| **Auto-download covers** | Fetch cover images automatically | On |
| **Max concurrent downloads** | Simultaneous download limit (1–10) | `3` |
| **Preferred format** | Format chosen when a book offers several: EPUB, PDF, MOBI, or *Any available* | EPUB |

### Credentials storage

Credentials are stored in the plugin’s `data.json` in the vault (same as other Obsidian plugins) — plaintext, not OS-keychain protected. Do not commit a vault that contains production secrets.

## Awesome OPDS servers

Public catalogs you can add out of the box, plus self-hostable servers that expose an OPDS feed. Links and feed URLs below were re-checked for liveness (HTTP + content type). Statuses can change; if a feed fails, open the site and copy the current OPDS URL.

### Public catalogs

| Server | Description |
|--------|-------------|
| [Project Gutenberg](https://www.gutenberg.org/) | 75,000+ free public-domain classics (`https://www.gutenberg.org/ebooks/search.opds/`) — XML OPDS may sunset ~2027 in favor of OPDS 2.0 |
| [Standard Ebooks](https://standardebooks.org/) | Carefully proofed public-domain typography (`https://standardebooks.org/feeds/opds`) — **requires Patrons Circle / supporter credentials** (401 without login) |
| [Gallica](https://gallica.bnf.fr/) | Bibliothèque nationale de France digital library (`https://gallica.bnf.fr/opds`) |
| [Ebooks libres et gratuits](https://www.ebooksgratuits.com/) | French public-domain classics (`https://www.ebooksgratuits.com/opds`) |
| [Wolne Lektury](https://www.wolnelektury.pl/) | Polish free literature library (`https://wolnelektury.pl/opds/`) |
| [textos.info](https://textos.info/) | Free Spanish-language books (`https://textos.info/opds`) |
| [bokselskap.no](https://www.bokselskap.no/) | Norwegian classics and public-domain works (`https://www.bokselskap.no/wp-content/themes/bokselskap/tekster/opds/root.xml`) |
| [Knihi.com](https://knihi.com/) | Belarusian free library — PDF and other formats (`https://knihi.com/opds.xml`) |
| [The Anarchist Library](https://theanarchistlibrary.org/) | Multilingual free library (`https://theanarchistlibrary.org/opds`) |
| [Feedbooks Test Catalog](https://github.com/Feedbooks/opds-test-catalog) | Feature-complete test feed for exercising OPDS clients |

### Self-hostable servers

Beyond the usual [awesome-opds](https://github.com/opds-community/awesome-opds) servers (Calibre, Amusewiki, Kavita, Komga, Stump, Calibre2OPDS), these also ship OPDS feeds:

| Server | Description |
|--------|-------------|
| [Calibre-Web](https://github.com/janeczku/calibre-web) | Web UI for a Calibre DB; OPDS at `/opds` (often port 8083) |
| [COPS](https://github.com/seblucas/cops) | Lightweight PHP OPDS/HTML server for a Calibre library — no heavy dependencies |
| [dir2opds](https://github.com/dubyte/dir2opds) | Go OPDS 1.1 server that turns a plain folder into a library — no database |
| [OPDShelf](https://github.com/DanielPereod/opdshelf) | Fast Bun-based OPDS server with admin UI; no database required |
| [ROPDS](https://github.com/dshein-alt/ropds) | Rust OPDS 1.2 / 2.0 server with web UI and multi-user auth |
| [pyopds-server](https://github.com/c4software/pyopds-server) | Minimal Python OPDS server for an EPUB folder (stdlib only) |
| [Tome](https://github.com/bndct-devops/tome) | Ebook library with KOReader sync, reading stats, and OPDS feed |
| [Grimmory](https://grimmory.org/) | Self-hosted ebooks/comics/audiobooks with OPDS + Komga-compatible API (community fork of BookLore) |
| [BookLore](https://github.com/booklore-app/BookLore) | Multi-user library, smart shelves, Kobo/KOReader sync, OPDS |
| [BookOrbit](https://bookorbit.app/) | Self-hosted ebooks/audiobooks/comics with multi-user libraries, Kobo/KOReader sync, and OPDS at `/api/v1/opds` (Basic auth via Settings → OPDS accounts) |
| [BackIssue](https://backissue.app/) | Comic/manga server with OPDS 1.2 and 2.0 at `/api/opds` |
| [abs-opds](https://github.com/Vito0912/abs-opds) | OPDS catalog layer for Audiobookshelf |
| [bopds](https://github.com/htol/bopds) | Go OPDS 1.2 server focused on FB2 libraries (with on-the-fly conversion) |
| [TinyOPDS](https://github.com/sensboston/tinyopds) | Lightweight OPDS server for home libraries (C# / .NET or Mono; Windows, Linux, macOS) |
| [Amusewiki](https://amusewiki.org/) | Library-oriented wiki with built-in OPDS catalog support |
| [Calibre](https://calibre-ebook.com/) | Ebook manager with built-in Content server that serves OPDS at `/opds` |
| [Calibre2OPDS](https://github.com/calibre2opds/calibre2opds) | Static OPDS catalog generator for sharing a Calibre library without a live server |
| [Kavita](https://www.kavitareader.com/) | Self-hosted library for EPUB, PDF, comics, and manga with OPDS and page streaming |
| [Komga](https://komga.org/) | Media server for comics, manga, and ebooks with OPDS v1 and v2 feeds |
| [Stump](https://stumpapp.dev/) | Modern self-hosted comics, manga, and digital book server with OPDS |

Note: this plugin speaks OPDS 1.x (Atom/XML). OPDS 2.0-only feeds (e.g. Open Library’s `/opds/`) are not compatible.

## License

MIT
