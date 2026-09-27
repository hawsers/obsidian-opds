export interface OPDSFeed {
  id: string;
  title: string;
  updated: string;
  author: OPDSPerson[];
  link: OPDSLink[];
  entry: OPDSEntry[];
  facetGroup?: OPDSFacetGroup[];
  startIndex?: number;
  itemsPerPage?: number;
  totalResults?: number;
}

export interface OPDSEntry {
  id: string;
  title: string;
  updated: string;
  published?: string;
  author: OPDSPerson[];
  contributor?: OPDSPerson[];
  category: OPDSCategory[];
  summary?: string;
  content?: string;
  link: OPDSLink[];
  rights?: string;
  dcTerms?: OPDSDCTerms;
}

export interface OPDSPerson {
  name: string;
  uri?: string;
  email?: string;
}

export interface OPDSLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  length?: number;
  properties?: Record<string, unknown>;
}

export interface OPDSCategory {
  scheme: string;
  term: string;
  label?: string;
}

export interface OPDSFacetGroup {
  title: string;
  facet: OPDSFacet[];
}

export interface OPDSFacet {
  value: string;
  count: number;
  title?: string;
  href?: string;
  active?: boolean;
}

export interface OPDSDCTerms {
  identifier?: string[];
  issued?: string;
  modified?: string;
  language?: string;
  publisher?: string;
  subject?: string[];
  description?: string;
  type?: string;
  format?: string;
  relation?: string;
  coverage?: string;
  rights?: string;
}

export interface OPDSAcquisitionFeed {
  rel: string;
  type: string;
  href: string;
  title?: string;
}

export interface OPDSBook extends OPDSEntry {
  coverUrl?: string;
  downloadLinks: OPDSAcquisitionFeed[];
  authors: string[];
  subjects: string[];
  languages: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  identifiers: Record<string, string>;
}

export interface OPDSLibrary {
  id: string;
  title: string;
  description?: string;
  catalogs: OPDSCatalog[];
  authentication?: OPDSAuthentication;
}

export interface OPDSCatalog {
  id: string;
  title: string;
  description?: string;
  url: string;
  type: "navigation" | "acquisition" | "search";
  kind?: "catalog" | "shelf" | "subscription" | "sort" | "featured";
}

export interface OPDSAuthentication {
  type: "none" | "basic" | "bearer" | "oauth2";
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}
