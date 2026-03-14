import type { PaperContextRef } from "../../shared/types";
import type { AgentToolContext } from "../types";
import type { ZoteroGateway } from "./zoteroGateway";

type SearchMode =
  | "recommendations"
  | "references"
  | "citations"
  | "search"
  | "metadata";

type SearchSource = "openalex" | "arxiv" | "europepmc";

type SearchInput = {
  itemId?: number;
  paperContext?: PaperContextRef;
  doi?: string;
  title?: string;
  arxivId?: string;
  query?: string;
  mode: SearchMode;
  source?: SearchSource;
  limit?: number;
  libraryID?: number;
};

type OnlinePaperResult = {
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  citationCount?: number;
  openAccessUrl?: string;
  sourceUrl?: string;
};

type ExternalMetadataResult = {
  source: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: string | number;
  abstract?: string;
  venue?: string;
  citationCount?: number;
  url?: string;
  type?: string;
};

type LiteratureSearchResult =
  | {
      results: OnlinePaperResult[];
      total?: number;
      source?: string;
      query?: string;
      doi?: string;
      openAlexId?: string | null;
      openAlexUrl?: string;
      warnings?: string[];
      message?: string;
    }
  | {
      results: ExternalMetadataResult[];
      warnings?: string[];
      message?: string;
    };

type FetchJsonResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchTextResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchJsonResponse>;

type FetchTextLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchTextResponse>;

interface XmlElement {
  querySelector(selector: string): XmlElement | null;
  querySelectorAll(selector: string): XmlElement[];
  getAttribute(name: string): string | null;
  textContent: string | null;
}

interface XmlDocument extends XmlElement {
  querySelectorAll(selector: string): XmlElement[];
}

interface XmlDomParser {
  parseFromString(text: string, mimeType: string): XmlDocument;
}

const OA_SELECT =
  "id,doi,display_name,authorships,publication_year,abstract_inverted_index,cited_by_count,open_access";
const OA_MAILTO = "mailto=llm-for-zotero@github.com";
const OA_BASE = "https://api.openalex.org";
const USER_AGENT =
  "llm-for-zotero/1.0 (https://github.com/yilewang/llm-for-zotero)";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await (
    globalThis as typeof globalThis & { fetch?: FetchLike }
  ).fetch!(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function oaFetch(url: string): Promise<unknown> {
  const separator = url.includes("?") ? "&" : "?";
  return fetchJson(`${url}${separator}${OA_MAILTO}`);
}

function reconstructAbstract(invertedIndex: unknown): string {
  if (!invertedIndex || typeof invertedIndex !== "object" || Array.isArray(invertedIndex)) {
    return "";
  }
  const entries: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(
    invertedIndex as Record<string, unknown>,
  )) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === "number") {
        entries.push([word, position]);
      }
    }
  }
  entries.sort((left, right) => left[1] - right[1]);
  return entries.map(([word]) => word).join(" ").trim();
}

function normalizeOpenAlexWork(raw: unknown): OnlinePaperResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const work = raw as Record<string, unknown>;
  const title = normalizeString(work.display_name);
  if (!title) {
    return null;
  }

  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  const authors = authorships
    .map((entry) => {
      const author = (entry as Record<string, unknown>)?.author;
      return normalizeString((author as Record<string, unknown>)?.display_name);
    })
    .filter(Boolean);

  const year =
    typeof work.publication_year === "number" && work.publication_year > 0
      ? work.publication_year
      : undefined;
  const abstractText = reconstructAbstract(work.abstract_inverted_index);
  const abstract = abstractText
    ? `${abstractText.slice(0, 400)}${abstractText.length > 400 ? "..." : ""}`
    : undefined;
  const doiUrl = normalizeString(work.doi);
  const doi = doiUrl.startsWith("https://doi.org/")
    ? doiUrl.slice("https://doi.org/".length)
    : doiUrl || undefined;
  const citationCount =
    typeof work.cited_by_count === "number" ? work.cited_by_count : undefined;
  const openAccess = work.open_access as Record<string, unknown> | null | undefined;
  const openAccessUrl = normalizeString(openAccess?.oa_url) || undefined;
  const openAlexId = normalizeString(work.id) || undefined;

  return {
    title,
    authors,
    year,
    abstract,
    doi,
    citationCount,
    openAccessUrl,
    sourceUrl: openAlexId,
  };
}

function extractOpenAlexId(url: string): string | null {
  const match = /\/(W\d+)$/.exec(url.trim());
  return match?.[1] ?? null;
}

async function resolveOpenAlexWork(doi: string): Promise<Record<string, unknown> | null> {
  try {
    const encodedDoi = encodeURIComponent(`https://doi.org/${doi}`);
    const raw = (await oaFetch(
      `${OA_BASE}/works/${encodedDoi}?select=${OA_SELECT},related_works,referenced_works`,
    )) as Record<string, unknown>;
    return raw ?? null;
  } catch {
    return null;
  }
}

async function batchFetchWorks(
  ids: string[],
  limit: number,
): Promise<OnlinePaperResult[]> {
  const slice = ids.slice(0, limit);
  if (!slice.length) {
    return [];
  }
  const filter = `openalex:${slice.join("|")}`;
  const raw = (await oaFetch(
    `${OA_BASE}/works?filter=${encodeURIComponent(filter)}&select=${OA_SELECT}&per-page=${slice.length}`,
  )) as { results?: unknown[] };
  return (raw.results ?? [])
    .map(normalizeOpenAlexWork)
    .filter((paper): paper is OnlinePaperResult => Boolean(paper));
}

async function fetchRelated(
  work: Record<string, unknown>,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const relatedUrls = Array.isArray(work.related_works)
    ? (work.related_works as string[])
    : [];
  const ids = relatedUrls
    .map(extractOpenAlexId)
    .filter((id): id is string => Boolean(id));
  return batchFetchWorks(ids, limit);
}

async function fetchReferences(
  work: Record<string, unknown>,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const referenceUrls = Array.isArray(work.referenced_works)
    ? (work.referenced_works as string[])
    : [];
  const ids = referenceUrls
    .map(extractOpenAlexId)
    .filter((id): id is string => Boolean(id));
  return batchFetchWorks(ids, limit);
}

async function fetchCitations(
  openAlexId: string,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const raw = (await oaFetch(
    `${OA_BASE}/works?filter=cites:${encodeURIComponent(openAlexId)}&sort=cited_by_count:desc&select=${OA_SELECT}&per-page=${limit}`,
  )) as { results?: unknown[] };
  return (raw.results ?? [])
    .map(normalizeOpenAlexWork)
    .filter((paper): paper is OnlinePaperResult => Boolean(paper));
}

async function fetchKeywordSearch(
  query: string,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const raw = (await oaFetch(
    `${OA_BASE}/works?search=${encodeURIComponent(query)}&select=${OA_SELECT}&per-page=${limit}`,
  )) as { results?: unknown[] };
  return (raw.results ?? [])
    .map(normalizeOpenAlexWork)
    .filter((paper): paper is OnlinePaperResult => Boolean(paper));
}

async function fetchArxivSearch(
  query: string,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const url =
    `https://export.arxiv.org/api/query` +
    `?search_query=all:${encodeURIComponent(query)}` +
    `&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
  const response = await (
    globalThis as typeof globalThis & { fetch?: FetchTextLike }
  ).fetch!(url, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`arXiv HTTP ${response.status}`);
  }

  const xmlText = await response.text();
  const domParser = new (
    globalThis as typeof globalThis & { DOMParser: new () => XmlDomParser }
  ).DOMParser();
  const doc = domParser.parseFromString(xmlText, "text/xml");
  const entries = doc.querySelectorAll("entry");
  const results: OnlinePaperResult[] = [];

  for (const entry of entries) {
    const title = entry
      .querySelector("title")
      ?.textContent?.trim()
      .replace(/\s+/g, " ");
    if (!title) {
      continue;
    }
    const abstractText = entry
      .querySelector("summary")
      ?.textContent?.trim()
      .replace(/\s+/g, " ");
    const abstract = abstractText
      ? `${abstractText.slice(0, 400)}${abstractText.length > 400 ? "..." : ""}`
      : undefined;
    const publishedValue = entry.querySelector("published")?.textContent?.trim() ?? "";
    const year = publishedValue
      ? (parseInt(publishedValue.slice(0, 4), 10) || undefined)
      : undefined;
    const authors: string[] = [];
    for (const author of entry.querySelectorAll("author")) {
      const name = author.querySelector("name")?.textContent?.trim();
      if (name) {
        authors.push(name);
      }
    }
    const sourceUrl = entry.querySelector("id")?.textContent?.trim() ?? undefined;
    const pdfLink =
      entry
        .querySelectorAll("link")
        .find((node: XmlElement) => node.getAttribute("type") === "application/pdf")
        ?.getAttribute("href") ?? undefined;
    const doi = entry.querySelector("doi")?.textContent?.trim() || undefined;
    results.push({
      title,
      authors,
      year,
      abstract,
      doi,
      sourceUrl,
      openAccessUrl: pdfLink || sourceUrl,
    });
  }

  return results;
}

async function fetchEuropePmcSearch(
  query: string,
  limit: number,
): Promise<OnlinePaperResult[]> {
  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=${encodeURIComponent(query)}` +
    `&format=json&pageSize=${limit}&resultType=core&sort=RELEVANCE`;
  const raw = (await fetchJson(url)) as {
    resultList?: { result?: Array<Record<string, unknown>> };
  };
  const items = raw.resultList?.result ?? [];
  return items
    .map((item): OnlinePaperResult | null => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) {
        return null;
      }

      const authorString =
        typeof item.authorString === "string" ? item.authorString.trim() : "";
      const authors = authorString
        ? authorString.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [];
      const yearRaw = item.pubYear ?? item.firstPublicationDate;
      const year =
        typeof yearRaw === "string"
          ? (parseInt(yearRaw.slice(0, 4), 10) || undefined)
          : typeof yearRaw === "number"
            ? yearRaw
            : undefined;
      const abstractText =
        typeof item.abstractText === "string" ? item.abstractText.trim() : "";
      const abstract = abstractText
        ? `${abstractText.slice(0, 400)}${abstractText.length > 400 ? "..." : ""}`
        : undefined;
      const doi =
        typeof item.doi === "string" && item.doi.trim()
          ? item.doi.trim()
          : undefined;
      const citationCount =
        typeof item.citedByCount === "number" ? item.citedByCount : undefined;
      const paperId = typeof item.id === "string" ? item.id.trim() : undefined;
      const sourceUrl = paperId
        ? `https://europepmc.org/article/${item.source ?? "MED"}/${paperId}`
        : doi
          ? `https://doi.org/${doi}`
          : undefined;
      const urlList =
        (item.fullTextUrlList as { fullTextUrl?: Array<{ url: string }> } | undefined)
          ?.fullTextUrl ?? [];
      const openAccessUrl = urlList[0]?.url || (doi ? `https://doi.org/${doi}` : undefined);
      return {
        title,
        authors,
        year,
        abstract,
        doi,
        citationCount,
        sourceUrl,
        openAccessUrl,
      };
    })
    .filter((paper): paper is OnlinePaperResult => Boolean(paper));
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isActivePaper(
  activeDoi: string | undefined,
  activeTitleKey: string | undefined,
  result: OnlinePaperResult,
): boolean {
  if (activeDoi && result.doi) {
    if (activeDoi.trim().toLowerCase() === result.doi.trim().toLowerCase()) {
      return true;
    }
  }
  if (activeTitleKey && activeTitleKey.length > 20) {
    const resultKey = normalizeTitleKey(result.title);
    if (resultKey === activeTitleKey) {
      return true;
    }
    if (resultKey.startsWith(activeTitleKey) || activeTitleKey.startsWith(resultKey)) {
      return true;
    }
  }
  return false;
}

async function lookupCrossRefByDoi(
  doi: string,
): Promise<ExternalMetadataResult | null> {
  try {
    const encodedDoi = encodeURIComponent(doi);
    const data = (await fetchJson(
      `https://api.crossref.org/works/${encodedDoi}`,
    )) as { message?: Record<string, unknown> };
    const message = data?.message;
    if (!message) {
      return null;
    }
    const titleList = Array.isArray(message.title) ? (message.title as string[]) : [];
    const authorList = Array.isArray(message.author)
      ? (message.author as Array<{ given?: string; family?: string; name?: string }>)
      : [];
    const authors = authorList
      .map((author) =>
        author.name ? author.name : [author.given, author.family].filter(Boolean).join(" "),
      )
      .filter(Boolean);
    const published = (
      message["published-print"] ||
      message["published-online"] ||
      message.published
    ) as { "date-parts"?: number[][] } | undefined;
    const year = published?.["date-parts"]?.[0]?.[0];
    const containerTitle = Array.isArray(message["container-title"])
      ? (message["container-title"] as string[])
      : [];
    const abstractText = normalizeString(message.abstract);
    return {
      source: "CrossRef",
      doi: normalizeString(message.DOI) || doi,
      title: titleList[0] ? stripHtmlTags(titleList[0]) : undefined,
      authors,
      year: year ?? undefined,
      abstract: abstractText ? stripHtmlTags(abstractText).slice(0, 600) : undefined,
      venue: containerTitle[0] ? stripHtmlTags(containerTitle[0]) : undefined,
      type: normalizeString(message.type) || undefined,
      url: normalizeString(message.URL) || undefined,
    };
  } catch {
    return null;
  }
}

async function searchCrossRef(query: string): Promise<ExternalMetadataResult[]> {
  try {
    const encoded = encodeURIComponent(query);
    const data = (await fetchJson(
      `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=3&select=DOI,title,author,published-print,published-online,abstract,container-title,type,URL`,
    )) as { message?: { items?: unknown[] } };
    const items = data?.message?.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => {
        const message = item as Record<string, unknown>;
        const titleList = Array.isArray(message.title) ? (message.title as string[]) : [];
        const authorList = Array.isArray(message.author)
          ? (message.author as Array<{ given?: string; family?: string; name?: string }>)
          : [];
        const authors = authorList
          .map((author) =>
            author.name
              ? author.name
              : [author.given, author.family].filter(Boolean).join(" "),
          )
          .filter(Boolean);
        const published = (
          message["published-print"] ||
          message["published-online"] ||
          message.published
        ) as { "date-parts"?: number[][] } | undefined;
        const year = published?.["date-parts"]?.[0]?.[0];
        const containerTitle = Array.isArray(message["container-title"])
          ? (message["container-title"] as string[])
          : [];
        const abstractText = normalizeString(message.abstract);
        const doi = normalizeString(message.DOI);
        return {
          source: "CrossRef",
          doi: doi || undefined,
          title: titleList[0] ? stripHtmlTags(titleList[0]) : undefined,
          authors,
          year: year ?? undefined,
          abstract: abstractText ? stripHtmlTags(abstractText).slice(0, 600) : undefined,
          venue: containerTitle[0] ? stripHtmlTags(containerTitle[0]) : undefined,
          type: normalizeString(message.type) || undefined,
          url: normalizeString(message.URL) || undefined,
        } satisfies ExternalMetadataResult;
      })
      .filter((result) => result.title || result.doi);
  } catch {
    return [];
  }
}

async function lookupSemanticScholar(params: {
  doi?: string;
  title?: string;
  arxivId?: string;
}): Promise<ExternalMetadataResult | null> {
  try {
    const fields =
      "title,authors,year,abstract,externalIds,citationCount,venue,publicationTypes,openAccessPdf";
    let url: string;
    if (params.doi) {
      url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(params.doi)}?fields=${fields}`;
    } else if (params.arxivId) {
      const cleaned = params.arxivId.replace(/^arxiv:/i, "");
      url = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(cleaned)}?fields=${fields}`;
    } else if (params.title) {
      const encoded = encodeURIComponent(params.title);
      url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&fields=${fields}&limit=1`;
    } else {
      return null;
    }

    const raw = (await fetchJson(url)) as Record<string, unknown>;
    const paper =
      params.doi || params.arxivId ? raw : (raw as { data?: unknown[] }).data?.[0];
    if (!paper || typeof paper !== "object") {
      return null;
    }

    const result = paper as Record<string, unknown>;
    const authorList = Array.isArray(result.authors)
      ? (result.authors as Array<{ name?: string }>)
      : [];
    const authors = authorList
      .map((author) => normalizeString(author.name))
      .filter(Boolean);
    const externalIds = (result.externalIds || {}) as Record<string, string>;
    const publicationTypes = Array.isArray(result.publicationTypes)
      ? (result.publicationTypes as string[]).join(", ")
      : undefined;

    return {
      source: "Semantic Scholar",
      doi: externalIds.DOI || externalIds.doi || params.doi || undefined,
      title: normalizeString(result.title) || undefined,
      authors,
      year: typeof result.year === "number" ? result.year : undefined,
      abstract: normalizeString(result.abstract).slice(0, 600) || undefined,
      venue: normalizeString(result.venue) || undefined,
      citationCount:
        typeof result.citationCount === "number" ? result.citationCount : undefined,
      type: publicationTypes || undefined,
    };
  } catch {
    return null;
  }
}

export class LiteratureSearchService {
  constructor(private readonly zoteroGateway: ZoteroGateway) {}

  private resolveLookupSeed(
    input: SearchInput,
    context: AgentToolContext,
  ): {
    doi?: string;
    title?: string;
    arxivId?: string;
  } {
    let doi = input.doi;
    let title = input.title || input.query;
    const arxivId = input.arxivId;
    if (doi || title || arxivId) {
      return { doi, title, arxivId };
    }
    const metadataItem = this.zoteroGateway.resolveMetadataItem({
      request: context.request,
      item: context.item,
      itemId: input.itemId ?? input.paperContext?.itemId,
      paperContext: input.paperContext,
    });
    if (!metadataItem) {
      return { doi, title, arxivId };
    }
    const snapshot = this.zoteroGateway.getEditableArticleMetadata(metadataItem);
    if (!doi && snapshot?.fields.DOI) {
      doi = snapshot.fields.DOI.trim();
    }
    if (!title && snapshot?.title) {
      title = snapshot.title.trim();
    }
    return { doi, title, arxivId };
  }

  async execute(
    input: SearchInput,
    context: AgentToolContext,
  ): Promise<LiteratureSearchResult> {
    if (input.mode === "metadata") {
      return this.lookupMetadata(this.resolveLookupSeed(input, context));
    }
    return this.search(input, context);
  }

  private async lookupMetadata(params: {
    doi?: string;
    title?: string;
    arxivId?: string;
  }): Promise<LiteratureSearchResult> {
    const results: ExternalMetadataResult[] = [];
    if (params.doi) {
      const crossRef = await lookupCrossRefByDoi(params.doi);
      if (crossRef) {
        results.push(crossRef);
      }
    } else if (params.title) {
      const crossRefResults = await searchCrossRef(params.title);
      results.push(...crossRefResults.slice(0, 2));
    }

    const semanticScholar = await lookupSemanticScholar(params);
    if (semanticScholar) {
      results.push(semanticScholar);
    }

    if (!results.length) {
      return {
        results: [],
        message: "No metadata found for the given identifier.",
      };
    }
    return { results };
  }

  private async search(
    input: SearchInput,
    context: AgentToolContext,
  ): Promise<LiteratureSearchResult> {
    const mode = input.mode === "metadata" ? "search" : input.mode;
    const source = input.source ?? "openalex";
    const limit = input.limit ?? 10;
    let doi = input.doi;
    let titleFallback = input.query || input.title;
    let activeTitleKey: string | undefined;

    if (!doi) {
      const metadataItem = this.zoteroGateway.resolveMetadataItem({
        request: context.request,
        item: context.item,
        itemId: input.itemId ?? input.paperContext?.itemId,
        paperContext: input.paperContext,
      });
      if (metadataItem) {
        const snapshot = this.zoteroGateway.getEditableArticleMetadata(metadataItem);
        if (snapshot?.fields.DOI) {
          doi = snapshot.fields.DOI.trim();
        }
        if (!titleFallback && snapshot?.title) {
          titleFallback = snapshot.title.trim();
        }
        if (snapshot?.title) {
          activeTitleKey = normalizeTitleKey(snapshot.title);
        }
      }
    }

    const dedupe = (results: OnlinePaperResult[]): OnlinePaperResult[] =>
      results.filter((result) => !isActivePaper(doi, activeTitleKey, result));

    if (source === "arxiv") {
      const query = input.query || titleFallback;
      if (!query) {
        return { results: [], message: "No search query available for arXiv." };
      }
      const results = dedupe(await fetchArxivSearch(query, limit));
      return {
        results,
        total: results.length,
        source: "arXiv",
        query,
      };
    }

    if (source === "europepmc") {
      const query = input.query || titleFallback;
      if (!query) {
        return { results: [], message: "No search query available for Europe PMC." };
      }
      const results = dedupe(await fetchEuropePmcSearch(query, limit));
      return {
        results,
        total: results.length,
        source: "Europe PMC",
        query,
      };
    }

    if (mode === "search") {
      const query = input.query || titleFallback;
      if (!query) {
        return { results: [], message: "No search query available." };
      }
      const results = dedupe(await fetchKeywordSearch(query, limit));
      return {
        results,
        total: results.length,
        source: "OpenAlex",
        query,
      };
    }

    if (!doi) {
      if (titleFallback) {
        const results = dedupe(await fetchKeywordSearch(titleFallback, limit));
        return {
          results,
          total: results.length,
          source: "OpenAlex",
          query: titleFallback,
          warnings: [
            "DOI unavailable; returned keyword search results instead.",
          ],
        };
      }
      throw new Error(
        "No DOI found for the active paper. Provide a doi or query explicitly.",
      );
    }

    const work = await resolveOpenAlexWork(doi);
    if (!work) {
      if (titleFallback) {
        const results = dedupe(await fetchKeywordSearch(titleFallback, limit));
        return {
          results,
          total: results.length,
          source: "OpenAlex",
          query: titleFallback,
          warnings: [
            "Paper not found on OpenAlex by DOI; returned keyword search results instead.",
          ],
        };
      }
      throw new Error(`Paper with DOI "${doi}" was not found on OpenAlex.`);
    }

    const openAlexId = normalizeString(work.id) || null;
    let results: OnlinePaperResult[] = [];
    const warnings: string[] = [];

    if (mode === "recommendations") {
      results = dedupe(await fetchRelated(work, limit));
      if (results.length === 0 && titleFallback) {
        results = dedupe(await fetchKeywordSearch(titleFallback, limit));
        warnings.push(
          "OpenAlex had no related works yet; returned keyword search results instead.",
        );
        return {
          results,
          total: results.length,
          source: "OpenAlex",
          query: titleFallback,
          doi,
          openAlexId,
          warnings,
        };
      }
    } else if (mode === "references") {
      results = dedupe(await fetchReferences(work, limit));
    } else {
      if (!openAlexId) {
        throw new Error("Could not determine OpenAlex ID to query citations.");
      }
      results = dedupe(await fetchCitations(openAlexId, limit));
    }

    return {
      results,
      total: results.length,
      source: "OpenAlex",
      doi,
      openAlexId,
      openAlexUrl: openAlexId || undefined,
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
