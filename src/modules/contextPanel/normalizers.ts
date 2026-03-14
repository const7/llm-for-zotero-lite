import type {
  NoteContextRef,
  PaperContextRef,
  SelectedTextSource,
} from "./types";

type TextSanitizer = (value: string) => string;

function normalizeText(value: unknown, sanitize?: TextSanitizer): string {
  const raw = typeof value === "string" ? value : "";
  return (sanitize ? sanitize(raw) : raw).trim();
}

export function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

export function normalizeSelectedTextSource(value: unknown): SelectedTextSource {
  if (value === "model") return "model";
  if (value === "note") return "note";
  if (value === "note-edit") return "note-edit";
  return "pdf";
}

export function normalizeSelectedTextSources(
  value: unknown,
  count: number,
): SelectedTextSource[] {
  if (count <= 0) return [];
  const raw = Array.isArray(value) ? value : [];
  const out: SelectedTextSource[] = [];
  for (let index = 0; index < count; index++) {
    out.push(normalizeSelectedTextSource(raw[index]));
  }
  return out;
}

export function normalizeNoteContextRef(
  value: unknown,
  options?: {
    sanitizeText?: TextSanitizer;
  },
): NoteContextRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  const noteItemId = normalizePositiveInt(typed.noteItemId);
  if (!noteItemId) return undefined;
  const sanitize = options?.sanitizeText;
  const title = normalizeText(typed.title, sanitize);
  const noteKind =
    typed.noteKind === "standalone" ? "standalone" : "item";
  const parentItemId = normalizePositiveInt(typed.parentItemId) || undefined;
  return {
    noteItemId,
    parentItemId,
    noteKind,
    title: title || `Note ${noteItemId}`,
  };
}

export function normalizeSelectedTextNoteContexts(
  value: unknown,
  count: number,
  options?: {
    sanitizeText?: TextSanitizer;
  },
): (NoteContextRef | undefined)[] {
  if (count <= 0) return [];
  const raw = Array.isArray(value) ? value : [];
  const out: (NoteContextRef | undefined)[] = [];
  for (let index = 0; index < count; index++) {
    out.push(normalizeNoteContextRef(raw[index], options));
  }
  return out;
}

export function normalizeAttachmentContentHash(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

export function normalizePaperContextRefs(
  value: unknown,
  options?: {
    sanitizeText?: TextSanitizer;
  },
): PaperContextRef[] {
  if (!Array.isArray(value)) return [];
  const sanitize = options?.sanitizeText;
  const out: PaperContextRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const typed = entry as Record<string, unknown>;
    const itemId = normalizePositiveInt(typed.itemId);
    const contextItemId = normalizePositiveInt(typed.contextItemId);
    if (!itemId || !contextItemId) continue;
    const title = normalizeText(typed.title, sanitize);
    if (!title) continue;
    const attachmentTitle = normalizeText(typed.attachmentTitle, sanitize);
    const citationKey = normalizeText(typed.citationKey, sanitize);
    const firstCreator = normalizeText(typed.firstCreator, sanitize);
    const year = normalizeText(typed.year, sanitize);
    const dedupeKey = `${itemId}:${contextItemId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      itemId,
      contextItemId,
      title,
      attachmentTitle: attachmentTitle || undefined,
      citationKey: citationKey || undefined,
      firstCreator: firstCreator || undefined,
      year: year || undefined,
    });
  }
  return out;
}

export function normalizeSelectedTextPaperContexts(
  value: unknown,
  count: number,
  options?: {
    sanitizeText?: TextSanitizer;
  },
): (PaperContextRef | undefined)[] {
  if (count <= 0) return [];
  const raw = Array.isArray(value) ? value : [];
  const sanitize = options?.sanitizeText;
  const out: (PaperContextRef | undefined)[] = [];
  for (let index = 0; index < count; index++) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object") {
      out.push(undefined);
      continue;
    }
    const typed = entry as Record<string, unknown>;
    const itemId = normalizePositiveInt(typed.itemId);
    const contextItemId = normalizePositiveInt(typed.contextItemId);
    const title = normalizeText(typed.title, sanitize);
    if (!itemId || !contextItemId || !title) {
      out.push(undefined);
      continue;
    }
    const citationKey = normalizeText(typed.citationKey, sanitize);
    const attachmentTitle = normalizeText(typed.attachmentTitle, sanitize);
    const firstCreator = normalizeText(typed.firstCreator, sanitize);
    const year = normalizeText(typed.year, sanitize);
    out.push({
      itemId,
      contextItemId,
      title,
      attachmentTitle: attachmentTitle || undefined,
      citationKey: citationKey || undefined,
      firstCreator: firstCreator || undefined,
      year: year || undefined,
    });
  }
  return out;
}
