import type { PaperContextRef } from "./types";

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttachmentDisplayTitle(
  contextItem: Zotero.Item | null | undefined,
): string {
  if (!contextItem?.isAttachment?.()) return "";
  const title = normalizeText(String(contextItem.getField("title") || ""));
  if (title) return title;
  const filename = normalizeText(
    String(
      (contextItem as unknown as { attachmentFilename?: string })
        .attachmentFilename || "",
    ),
  );
  return filename;
}

function extractYearValue(value: unknown): string | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

export function resolvePaperContextDisplayMetadata(
  paperContext: PaperContextRef,
): {
  firstCreator?: string;
  year?: string;
} {
  let firstCreator = normalizeText(paperContext.firstCreator || "");
  let year = extractYearValue(paperContext.year);
  if ((!firstCreator || !year) && typeof Zotero !== "undefined") {
    const zoteroItem = Zotero.Items.get(paperContext.itemId);
    if (zoteroItem?.isRegularItem?.()) {
      if (!firstCreator) {
        firstCreator = normalizeText(
          String(
            zoteroItem.getField("firstCreator") ||
              (zoteroItem as Zotero.Item).firstCreator ||
              "",
          ),
        );
      }
      if (!year) {
        year =
          extractYearValue(zoteroItem.getField("year")) ||
          extractYearValue(zoteroItem.getField("date")) ||
          extractYearValue(zoteroItem.getField("issued"));
      }
    }
  }
  return {
    firstCreator: firstCreator || undefined,
    year: year || undefined,
  };
}

function extractFirstAuthorLastName(paperContext: PaperContextRef): string {
  const metadata = resolvePaperContextDisplayMetadata(paperContext);
  let creator = normalizeText(metadata.firstCreator || "");
  if (!creator) return "Paper";
  creator = creator
    .replace(/\s+et\s+al\.?$/i, "")
    .replace(/\s+al\.?$/i, "")
    .replace(/[;,.]+$/g, "")
    .trim();
  if (!creator) return "Paper";
  const primaryAuthor =
    creator.split(/\s+(?:and|&)\s+/i).find((part) => part.trim()) || creator;
  const normalizedPrimary = primaryAuthor.replace(/[;,.]+$/g, "").trim();
  if (!normalizedPrimary) return "Paper";
  if (normalizedPrimary.includes(",")) {
    const commaSeparated = normalizedPrimary.split(",")[0]?.trim();
    if (commaSeparated) return commaSeparated;
  }
  const parts = normalizedPrimary.split(/\s+/g).filter(Boolean);
  if (!parts.length) return "Paper";
  if (parts.length === 1) return parts[0];
  const trailingToken = parts[parts.length - 1];
  if (/^[A-Z](?:\.[A-Z])?\.?$/i.test(trailingToken)) {
    return parts[parts.length - 2] || parts[0];
  }
  return trailingToken;
}

export function formatPaperCitationLabel(
  paperContext: PaperContextRef | null | undefined,
): string {
  if (!paperContext) return "Paper";
  const authorLastName = extractFirstAuthorLastName(paperContext);
  const year = resolvePaperContextDisplayMetadata(paperContext).year;
  const citationKey = normalizeText(paperContext.citationKey || "");
  if (authorLastName !== "Paper") {
    const authorYearLabel = year
      ? `${authorLastName} et al., ${year}`
      : `${authorLastName} et al.`;
    if (citationKey) {
      return `${authorYearLabel} [${citationKey}]`;
    }
    return authorYearLabel;
  }
  const fallbackId =
    Number.isFinite(paperContext.itemId) && paperContext.itemId > 0
      ? Math.floor(paperContext.itemId)
      : Number.isFinite(paperContext.contextItemId) && paperContext.contextItemId > 0
        ? Math.floor(paperContext.contextItemId)
        : 0;
  if (citationKey) return citationKey;
  return fallbackId > 0 ? `Paper ${fallbackId}` : "Paper";
}

export function formatPaperSourceLabel(
  paperContext: PaperContextRef | null | undefined,
): string {
  return `(${formatPaperCitationLabel(paperContext)})`;
}

export function buildPaperQuoteCitationGuidance(
  paperContext?: PaperContextRef | null,
): string[] {
  return [
    "Paper-grounded citation format for the final answer:",
    "> quoted text from the paper",
    paperContext
      ? formatPaperSourceLabel(paperContext)
      : "(Author et al., Year)",
    "- Put the source label on the line immediately after the quote.",
    "- Use the matching paper metadata for the source label.",
    "- Do not cite raw chunk ids, citation keys, or invented page numbers unless they are explicitly provided.",
  ];
}

export function formatPaperContextReferenceLabel(
  paperContext: PaperContextRef | null | undefined,
): string {
  if (!paperContext) return "Paper";
  const citation = formatPaperCitationLabel(paperContext);
  const attachmentTitle = normalizeText(paperContext.attachmentTitle || "");
  const paperTitle = normalizeText(paperContext.title || "");
  const parts = [citation];
  if (paperTitle) parts.push(paperTitle);
  if (attachmentTitle) parts.push(`Attachment: ${attachmentTitle}`);
  return parts.join(" - ");
}

export function formatOpenChatTextContextLabel(
  paperContext: PaperContextRef | null | undefined,
): string {
  return `${formatPaperCitationLabel(paperContext)} - Text Context`;
}

export function resolvePaperContextRefFromAttachment(
  contextItem: Zotero.Item | null | undefined,
): PaperContextRef | null {
  if (
    !contextItem ||
    !contextItem.isAttachment?.() ||
    contextItem.attachmentContentType !== "application/pdf"
  ) {
    return null;
  }
  const parentItem = contextItem.parentID
    ? Zotero.Items.get(contextItem.parentID) || null
    : null;
  const paperItem = parentItem || contextItem;
  const paperItemId = Number(paperItem.id);
  const contextItemId = Number(contextItem.id);
  if (!Number.isFinite(paperItemId) || !Number.isFinite(contextItemId)) {
    return null;
  }
  const normalizedPaperItemId = Math.floor(paperItemId);
  const normalizedContextItemId = Math.floor(contextItemId);
  if (normalizedPaperItemId <= 0 || normalizedContextItemId <= 0) {
    return null;
  }

  const title = normalizeText(
    String(
      paperItem.getField("title") ||
        contextItem.getField("title") ||
        `Paper ${normalizedPaperItemId}`,
    ),
  );
  const citationKey = normalizeText(String(paperItem.getField("citationKey") || ""));
  const attachmentTitle = getAttachmentDisplayTitle(contextItem);
  const firstCreator = normalizeText(
    String(
      paperItem.getField("firstCreator") ||
        (paperItem as Zotero.Item).firstCreator ||
        "",
    ),
  );
  const year = normalizeText(
    String(
      paperItem.getField("year") ||
        paperItem.getField("date") ||
        paperItem.getField("issued") ||
        "",
    ),
  );

  return {
    itemId: normalizedPaperItemId,
    contextItemId: normalizedContextItemId,
    title: title || `Paper ${normalizedPaperItemId}`,
    attachmentTitle: attachmentTitle || undefined,
    citationKey: citationKey || undefined,
    firstCreator: firstCreator || undefined,
    year: year || undefined,
  };
}
