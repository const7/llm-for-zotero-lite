import { t } from "../../utils/i18n";
import type { Message } from "./types";
import { sanitizeText } from "./textUtils";

type QuestionTimelineEntry = {
  messageIndex: number;
  questionNumber: number;
  timestamp: number;
  label: string;
  fullText: string;
};

type QuestionTimelineSyncOptions = {
  body: Element;
  chatBox: HTMLDivElement;
  history: Message[];
  conversationKey: number;
  jumpToMessageIndex: (messageIndex: number) => void;
  persistScroll: () => void;
};

const QUESTION_TIMELINE_LABEL_MAX_CHARS = 72;
const QUESTION_TIMELINE_TOOLTIP_MARGIN = 12;
const QUESTION_TIMELINE_TOOLTIP_GAP = 10;
const QUESTION_TIMELINE_TOOLTIP_PREFERRED_WIDTH = 300;
const QUESTION_TIMELINE_TOOLTIP_MIN_SIDE_WIDTH = 180;
const questionTimelineScrollHandlers = new WeakMap<
  HTMLDivElement,
  { listener: EventListener; rafId: number | null }
>();
const questionTimelineOptions = new WeakMap<
  HTMLElement,
  QuestionTimelineSyncOptions
>();

function getQuestionTimelineTooltip(timeline: HTMLElement): HTMLElement | null {
  const doc = timeline.ownerDocument;
  if (!doc) return null;
  return doc.getElementById(
    "llm-question-timeline-tooltip",
  ) as HTMLElement | null;
}

function hideQuestionTimelineTooltip(timeline: HTMLElement): void {
  const tooltip = getQuestionTimelineTooltip(timeline);
  if (!tooltip) return;
  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.textContent = "";
  tooltip.style.removeProperty("--llm-question-tooltip-top");
  tooltip.style.removeProperty("--llm-question-tooltip-left");
  tooltip.style.removeProperty("--llm-question-tooltip-width");
}

export function hideQuestionTimeline(body: Element): void {
  const timeline = body.querySelector(
    "#llm-question-timeline",
  ) as HTMLElement | null;
  if (!timeline) return;
  timeline.style.display = "none";
  hideQuestionTimelineTooltip(timeline);
  questionTimelineOptions.delete(timeline);
  delete timeline.dataset.timelineSignature;
  delete timeline.dataset.activeMessageIndex;
  const list = timeline.querySelector(
    "#llm-question-timeline-list",
  ) as HTMLElement | null;
  list?.replaceChildren();
}

function truncateQuestionTimelineLabel(text: string): string {
  const normalized = sanitizeText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= QUESTION_TIMELINE_LABEL_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, QUESTION_TIMELINE_LABEL_MAX_CHARS - 1).trimEnd()}...`;
}

function buildQuestionTimelineEntries(
  history: Message[],
): QuestionTimelineEntry[] {
  const entries: QuestionTimelineEntry[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message.role !== "user") continue;
    const fullText = sanitizeText(message.text || "")
      .replace(/\s+/g, " ")
      .trim();
    const questionNumber = entries.length + 1;
    entries.push({
      messageIndex: index,
      questionNumber,
      timestamp: Math.floor(message.timestamp || 0),
      label:
        truncateQuestionTimelineLabel(fullText) ||
        `${t("Question")} ${questionNumber}`,
      fullText,
    });
  }
  return entries;
}

function getQuestionTimelineSignature(
  conversationKey: number,
  entries: QuestionTimelineEntry[],
): string {
  return `${conversationKey}|${entries
    .map(
      (entry) => `${entry.messageIndex}:${entry.timestamp}:${entry.fullText}`,
    )
    .join("|")}`;
}

function setQuestionTimelineActive(
  timeline: HTMLElement,
  messageIndex: number | null,
): void {
  const activeValue = messageIndex === null ? "" : `${messageIndex}`;
  if ((timeline.dataset.activeMessageIndex || "") === activeValue) return;
  if (activeValue) {
    timeline.dataset.activeMessageIndex = activeValue;
  } else {
    delete timeline.dataset.activeMessageIndex;
  }
  const entries = Array.from(
    timeline.querySelectorAll(".llm-question-timeline-item"),
  ) as HTMLElement[];
  entries.forEach((entryEl) => {
    const active = entryEl.dataset.messageIndex === activeValue;
    entryEl.classList.toggle("active", active);
    entryEl.setAttribute("aria-current", active ? "true" : "false");
  });
}

function updateQuestionTimelineActive(
  chatBox: HTMLDivElement,
  timeline: HTMLElement,
): void {
  const userRows = Array.from(
    chatBox.querySelectorAll(".llm-message-wrapper.user[data-message-index]"),
  ) as HTMLElement[];
  if (!userRows.length) {
    setQuestionTimelineActive(timeline, null);
    return;
  }
  const viewportTop = chatBox.scrollTop + 24;
  let activeRow = userRows[0];
  for (const row of userRows) {
    if (row.offsetTop <= viewportTop) {
      activeRow = row;
    } else {
      break;
    }
  }
  const activeIndex = Number(activeRow.dataset.messageIndex || "");
  setQuestionTimelineActive(
    timeline,
    Number.isFinite(activeIndex) ? activeIndex : null,
  );
}

function ensureQuestionTimelineScrollHandler(
  chatBox: HTMLDivElement,
  timeline: HTMLElement,
): void {
  if (questionTimelineScrollHandlers.has(chatBox)) return;
  let rafId: number | null = null;
  const listener = () => {
    const win = chatBox.ownerDocument?.defaultView;
    if (!win || rafId !== null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      if (!chatBox.isConnected || !timeline.isConnected) return;
      updateQuestionTimelineActive(chatBox, timeline);
    });
  };
  chatBox.addEventListener("scroll", listener, { passive: true });
  questionTimelineScrollHandlers.set(chatBox, { listener, rafId });
}

function showQuestionTimelineTooltip(
  timeline: HTMLElement,
  item: HTMLElement,
  entry: QuestionTimelineEntry,
): void {
  const text = entry.fullText || entry.label;
  if (!text) return;
  const tooltip = getQuestionTimelineTooltip(timeline);
  if (!tooltip) return;

  const doc = timeline.ownerDocument;
  if (!doc) return;
  const win = doc.defaultView;
  if (!win) return;
  const margin = QUESTION_TIMELINE_TOOLTIP_MARGIN;
  const viewportWidth = win.innerWidth || 0;
  const viewportHeight = win.innerHeight || 0;
  if (viewportWidth <= margin * 2 || viewportHeight <= margin * 2) return;

  const panel = timeline.querySelector(
    ".llm-question-timeline-panel",
  ) as HTMLElement | null;
  const panelRect = (panel || timeline).getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const maxWidth = Math.max(160, viewportWidth - margin * 2);
  let width = Math.min(QUESTION_TIMELINE_TOOLTIP_PREFERRED_WIDTH, maxWidth);
  const leftSpace = panelRect.left - QUESTION_TIMELINE_TOOLTIP_GAP - margin;
  let left = panelRect.left - QUESTION_TIMELINE_TOOLTIP_GAP - width;
  if (left < margin) {
    if (leftSpace >= QUESTION_TIMELINE_TOOLTIP_MIN_SIDE_WIDTH) {
      width = Math.min(width, leftSpace);
      left = margin;
    } else {
      left = Math.min(
        Math.max(margin, panelRect.right - width),
        viewportWidth - margin - width,
      );
    }
  }
  let top = itemRect.top + itemRect.height / 2;
  tooltip.textContent = text;
  tooltip.style.setProperty(
    "--llm-question-tooltip-top",
    `${Math.round(top)}px`,
  );
  tooltip.style.setProperty(
    "--llm-question-tooltip-left",
    `${Math.round(left)}px`,
  );
  tooltip.style.setProperty(
    "--llm-question-tooltip-width",
    `${Math.round(width)}px`,
  );
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.classList.add("visible");

  const tooltipRect = tooltip.getBoundingClientRect();
  if (tooltipRect.top < margin) {
    top += margin - tooltipRect.top;
  } else if (tooltipRect.bottom > viewportHeight - margin) {
    top -= tooltipRect.bottom - (viewportHeight - margin);
  }
  tooltip.style.setProperty(
    "--llm-question-tooltip-top",
    `${Math.round(top)}px`,
  );
}

function scrollToQuestionTimelineEntry(
  options: QuestionTimelineSyncOptions,
  messageIndex: number,
): void {
  const scrollToRenderedRow = (): boolean => {
    const row = options.chatBox.querySelector(
      `.llm-message-wrapper.user[data-message-index="${messageIndex}"]`,
    ) as HTMLElement | null;
    if (!row) return false;
    row.scrollIntoView({ block: "start", inline: "nearest" });
    const timeline = options.body.querySelector(
      "#llm-question-timeline",
    ) as HTMLElement | null;
    if (timeline) updateQuestionTimelineActive(options.chatBox, timeline);
    options.persistScroll();
    return true;
  };
  if (scrollToRenderedRow()) return;
  options.jumpToMessageIndex(messageIndex);
  const win = options.body.ownerDocument?.defaultView;
  if (win) {
    win.requestAnimationFrame(() => {
      scrollToRenderedRow();
    });
  }
}

export function syncQuestionTimeline(
  options: QuestionTimelineSyncOptions,
): void {
  const { body, chatBox, history, conversationKey } = options;
  const timeline = body.querySelector(
    "#llm-question-timeline",
  ) as HTMLElement | null;
  const list = body.querySelector(
    "#llm-question-timeline-list",
  ) as HTMLElement | null;
  if (!timeline || !list) return;
  questionTimelineOptions.set(timeline, options);

  const entries = buildQuestionTimelineEntries(history);
  if (entries.length < 2) {
    hideQuestionTimeline(body);
    return;
  }

  timeline.style.display = "";
  const signature = getQuestionTimelineSignature(conversationKey, entries);
  if (timeline.dataset.timelineSignature !== signature) {
    const doc = body.ownerDocument;
    if (!doc) return;
    const fragment = doc.createDocumentFragment();
    for (const entry of entries) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "llm-question-timeline-item";
      button.dataset.messageIndex = `${entry.messageIndex}`;
      button.setAttribute(
        "aria-label",
        `${t("Jump to question")} ${entry.questionNumber}: ${entry.fullText || entry.label}`,
      );

      const marker = doc.createElement("span");
      marker.className = "llm-question-timeline-marker";
      marker.textContent = `${entry.questionNumber}`;

      const label = doc.createElement("span");
      label.className = "llm-question-timeline-label";
      label.textContent = entry.label;

      button.append(marker, label);
      button.addEventListener("mouseenter", () => {
        showQuestionTimelineTooltip(timeline, button, entry);
      });
      button.addEventListener("mouseleave", () => {
        hideQuestionTimelineTooltip(timeline);
      });
      button.addEventListener("focus", () => {
        showQuestionTimelineTooltip(timeline, button, entry);
      });
      button.addEventListener("blur", () => {
        hideQuestionTimelineTooltip(timeline);
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        scrollToQuestionTimelineEntry(
          questionTimelineOptions.get(timeline) || options,
          entry.messageIndex,
        );
      });
      fragment.appendChild(button);
    }
    hideQuestionTimelineTooltip(timeline);
    list.replaceChildren(fragment);
    timeline.dataset.timelineSignature = signature;
    delete timeline.dataset.activeMessageIndex;
  }

  ensureQuestionTimelineScrollHandler(chatBox, timeline);
  updateQuestionTimelineActive(chatBox, timeline);
}
