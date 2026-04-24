import {
  config,
  BUILTIN_SHORTCUT_FILES,
  MAX_EDITABLE_SHORTCUTS,
} from "./constants";
import type { CustomShortcut } from "./types";
import { shortcutTextCache } from "./state";
import {
  getShortcutOverrides,
  setShortcutOverrides,
  getShortcutLabelOverrides,
  setShortcutLabelOverrides,
  getDeletedShortcutIds,
  setDeletedShortcutIds,
  getCustomShortcuts,
  setCustomShortcuts,
  getShortcutOrder,
  setShortcutOrder,
  createCustomShortcutId,
  resetShortcutsToDefault,
} from "./prefHelpers";
import { setStatus } from "./textUtils";

type PromptShortcut = {
  id: string;
  kind: "builtin" | "custom";
  label: string;
  prompt?: string;
  file?: string;
};

export async function loadShortcutText(file: string): Promise<string> {
  if (shortcutTextCache.has(file)) {
    return shortcutTextCache.get(file)!;
  }
  const uri = `chrome://${config.addonRef}/content/shortcuts/${file}`;
  const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
  const res = await fetchFn(uri);
  if (!res.ok) {
    throw new Error(`Failed to load ${file}`);
  }
  const text = await res.text();
  shortcutTextCache.set(file, text);
  return text;
}

function getPromptShortcuts(): PromptShortcut[] {
  const overrides = getShortcutOverrides();
  const labelOverrides = getShortcutLabelOverrides();
  const deletedIds = new Set(getDeletedShortcutIds());
  const shortcuts: PromptShortcut[] = [];

  for (const shortcut of BUILTIN_SHORTCUT_FILES) {
    if (deletedIds.has(shortcut.id)) continue;
    shortcuts.push({
      id: shortcut.id,
      kind: "builtin",
      label: (labelOverrides[shortcut.id] || shortcut.label).trim(),
      prompt: (overrides[shortcut.id] || "").trim() || undefined,
      file: shortcut.file,
    });
  }

  for (const shortcut of getCustomShortcuts()) {
    shortcuts.push({
      id: shortcut.id,
      kind: "custom",
      label: shortcut.label.trim() || "Custom",
      prompt: shortcut.prompt.trim(),
    });
  }

  const shortcutIds = shortcuts.map((shortcut) => shortcut.id);
  const shortcutIdSet = new Set(shortcutIds);
  const savedOrder = getShortcutOrder();
  const normalizedOrder = [
    ...savedOrder.filter((id) => shortcutIdSet.has(id)),
    ...shortcutIds.filter((id) => !savedOrder.includes(id)),
  ];
  const order = new Map(normalizedOrder.map((id, index) => [id, index]));
  return shortcuts
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, MAX_EDITABLE_SHORTCUTS);
}

async function resolveShortcutPrompt(shortcut: PromptShortcut): Promise<string> {
  if (shortcut.prompt) return shortcut.prompt;
  if (!shortcut.file) return "";
  try {
    return (await loadShortcutText(shortcut.file)).trim();
  } catch {
    return "";
  }
}

function positionMenu(body: Element, menu: HTMLElement, x: number, y: number) {
  const win = body.ownerDocument?.defaultView;
  if (!win) return;
  const margin = 8;
  menu.style.display = "grid";
  menu.style.visibility = "hidden";
  menu.style.position = "fixed";
  menu.style.maxHeight = `${Math.max(120, win.innerHeight - margin * 2)}px`;
  menu.style.overflowY = "auto";

  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(margin, win.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, win.innerHeight - rect.height - margin);
  menu.style.left = `${Math.round(Math.min(Math.max(margin, x), maxLeft))}px`;
  menu.style.top = `${Math.round(Math.min(Math.max(margin, y), maxTop))}px`;
  menu.style.visibility = "visible";
}

function closeMenu(menu: HTMLElement | null) {
  if (!menu) return;
  menu.style.display = "none";
  menu.dataset.shortcutId = "";
  menu.dataset.shortcutKind = "";
}

function getShortcutFromButton(
  shortcuts: PromptShortcut[],
  button: HTMLButtonElement | null,
): PromptShortcut | null {
  const id = button?.dataset.shortcutId || "";
  return shortcuts.find((shortcut) => shortcut.id === id) || null;
}

function getShortcutButton(
  container: HTMLElement,
  target: EventTarget | null,
): HTMLButtonElement | null {
  const node = target as Node | null;
  const element =
    node && node.nodeType === 1
      ? (node as Element)
      : (node as any)?.parentElement || null;
  const button = element?.closest?.(
    ".llm-prompt-shortcut-btn",
  ) as HTMLButtonElement | null;
  return button && container.contains(button) ? button : null;
}

function getAddButton(
  container: HTMLElement,
  target: EventTarget | null,
): HTMLButtonElement | null {
  const node = target as Node | null;
  const element =
    node && node.nodeType === 1
      ? (node as Element)
      : (node as any)?.parentElement || null;
  const button = element?.closest?.(
    ".llm-prompt-shortcut-add",
  ) as HTMLButtonElement | null;
  return button && container.contains(button) ? button : null;
}

export async function renderShortcuts(
  body: Element,
  item?: Zotero.Item | null,
) {
  const container = body.querySelector(
    "#llm-shortcuts",
  ) as HTMLDivElement | null;
  const menu = body.querySelector(
    "#llm-shortcut-menu",
  ) as HTMLDivElement | null;
  const editBtn = body.querySelector(
    "#llm-shortcut-menu-edit",
  ) as HTMLButtonElement | null;
  const deleteBtn = body.querySelector(
    "#llm-shortcut-menu-delete",
  ) as HTMLButtonElement | null;
  const addBtn = body.querySelector(
    "#llm-shortcut-menu-add",
  ) as HTMLButtonElement | null;
  const resetBtn = body.querySelector(
    "#llm-shortcut-menu-reset",
  ) as HTMLButtonElement | null;
  if (!container) return;

  const shortcuts = getPromptShortcuts();
  const canSend = Boolean(item);
  container.replaceChildren();

  for (const shortcut of shortcuts) {
    const button = body.ownerDocument!.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    button.className = "llm-shortcut-btn llm-prompt-shortcut-btn";
    button.type = "button";
    button.textContent = shortcut.label;
    button.title = shortcut.label;
    button.disabled = !canSend;
    button.dataset.shortcutId = shortcut.id;
    button.dataset.shortcutKind = shortcut.kind;
    container.appendChild(button);
  }

  const addShortcutButton = body.ownerDocument!.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  addShortcutButton.className = "llm-shortcut-btn llm-prompt-shortcut-add";
  addShortcutButton.type = "button";
  addShortcutButton.textContent = "+";
  addShortcutButton.title = "Add prompt preset";
  container.appendChild(addShortcutButton);

  const renderAgain = async () => renderShortcuts(body, item);

  const addShortcut = async () => {
    if (shortcuts.length >= MAX_EDITABLE_SHORTCUTS) {
      const status = body.querySelector("#llm-status") as HTMLElement | null;
      if (status) {
        setStatus(
          status,
          `Maximum ${MAX_EDITABLE_SHORTCUTS} prompt presets allowed`,
          "error",
        );
      }
      return;
    }

    const updated = await openShortcutEditDialog("", "", "Add Shortcut");
    if (!updated) return;
    const prompt = updated.prompt.trim();
    if (!prompt) {
      const status = body.querySelector("#llm-status") as HTMLElement | null;
      if (status) setStatus(status, "Shortcut prompt cannot be empty", "error");
      return;
    }

    const shortcut: CustomShortcut = {
      id: createCustomShortcutId(),
      label: updated.label.trim() || "Custom",
      prompt,
    };
    setCustomShortcuts([...getCustomShortcuts(), shortcut]);
    setShortcutOrder([...getShortcutOrder(), shortcut.id]);
    await renderAgain();
  };

  container.onclick = async (event: Event) => {
    const addButton = getAddButton(container, event.target);
    if (addButton) {
      event.preventDefault();
      event.stopPropagation();
      await addShortcut();
      return;
    }

    const button = getShortcutButton(container, event.target);
    if (!button || !item) return;
    event.preventDefault();
    event.stopPropagation();

    const shortcut = getShortcutFromButton(shortcuts, button);
    const prompt = shortcut ? await resolveShortcutPrompt(shortcut) : "";
    if (!prompt) return;

    const inputBox = body.querySelector(
      "#llm-input",
    ) as HTMLTextAreaElement | null;
    const sendBtn = body.querySelector("#llm-send") as HTMLButtonElement | null;
    if (!inputBox || !sendBtn || sendBtn.disabled) return;

    inputBox.value = prompt;
    const EventCtor = body.ownerDocument?.defaultView?.Event || Event;
    inputBox.dispatchEvent(new EventCtor("input", { bubbles: true }));
    sendBtn.click();
  };

  container.oncontextmenu = (event: Event) => {
    if (!menu || !editBtn || !deleteBtn || !addBtn || !resetBtn) return;
    const mouseEvent = event as MouseEvent;
    event.preventDefault();
    event.stopPropagation();

    const button = getShortcutButton(container, mouseEvent.target);
    const shortcut = getShortcutFromButton(shortcuts, button);
    menu.dataset.shortcutId = shortcut?.id || "";
    menu.dataset.shortcutKind = shortcut?.kind || "";
    editBtn.style.display = shortcut ? "flex" : "none";
    deleteBtn.style.display = shortcut ? "flex" : "none";
    addBtn.style.display = "flex";
    resetBtn.style.display = "flex";
    addBtn.disabled = shortcuts.length >= MAX_EDITABLE_SHORTCUTS;
    positionMenu(body, menu, mouseEvent.clientX + 4, mouseEvent.clientY + 4);
  };

  if (menu && editBtn && deleteBtn && addBtn && resetBtn) {
    editBtn.onclick = async (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcuts.find(
        (entry) => entry.id === (menu.dataset.shortcutId || ""),
      );
      if (!shortcut) return;

      const currentPrompt = await resolveShortcutPrompt(shortcut);
      const updated = await openShortcutEditDialog(
        shortcut.label,
        currentPrompt,
      );
      closeMenu(menu);
      if (!updated) return;

      const nextPrompt = updated.prompt.trim();
      if (!nextPrompt) {
        const status = body.querySelector("#llm-status") as HTMLElement | null;
        if (status) setStatus(status, "Shortcut prompt cannot be empty", "error");
        return;
      }
      const nextLabel = updated.label.trim() || shortcut.label;

      if (shortcut.kind === "custom") {
        setCustomShortcuts(
          getCustomShortcuts().map((entry) =>
            entry.id === shortcut.id
              ? { ...entry, label: nextLabel, prompt: nextPrompt }
              : entry,
          ),
        );
      } else {
        const overrides = getShortcutOverrides();
        overrides[shortcut.id] = nextPrompt;
        setShortcutOverrides(overrides);

        const labelOverrides = getShortcutLabelOverrides();
        labelOverrides[shortcut.id] = nextLabel;
        setShortcutLabelOverrides(labelOverrides);
      }

      await renderAgain();
    };

    deleteBtn.onclick = async (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcuts.find(
        (entry) => entry.id === (menu.dataset.shortcutId || ""),
      );
      closeMenu(menu);
      if (!shortcut) return;

      if (shortcut.kind === "custom") {
        setCustomShortcuts(
          getCustomShortcuts().filter((entry) => entry.id !== shortcut.id),
        );
      } else {
        const deleted = new Set(getDeletedShortcutIds());
        deleted.add(shortcut.id);
        setDeletedShortcutIds(Array.from(deleted));

        const overrides = getShortcutOverrides();
        delete overrides[shortcut.id];
        setShortcutOverrides(overrides);

        const labels = getShortcutLabelOverrides();
        delete labels[shortcut.id];
        setShortcutLabelOverrides(labels);
      }
      setShortcutOrder(getShortcutOrder().filter((id) => id !== shortcut.id));
      await renderAgain();
    };

    addBtn.onclick = async (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(menu);
      await addShortcut();
    };

    resetBtn.onclick = async (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(menu);
      if (!(await openResetShortcutsDialog())) return;
      resetShortcutsToDefault();
      await renderAgain();
    };

    const panelRoot = body.querySelector("#llm-main") as HTMLElement | null;
    if (panelRoot && !panelRoot.dataset.shortcutMenuCloseAttached) {
      panelRoot.dataset.shortcutMenuCloseAttached = "true";
      panelRoot.addEventListener("click", () => closeMenu(menu));
      panelRoot.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape") closeMenu(menu);
      });
    }
  }
}

export async function openShortcutEditDialog(
  initialLabel: string,
  initialPrompt: string,
  dialogTitle = "Edit Shortcut",
): Promise<{ label: string; prompt: string } | null> {
  const dialogData: { [key: string]: any } = {
    labelValue: initialLabel || "",
    promptValue: initialPrompt || "",
    loadCallback: () => {
      return;
    },
    unloadCallback: () => {
      return;
    },
  };

  const dialog = new ztoolkit.Dialog(3, 2)
    .addCell(0, 0, {
      tag: "h2",
      properties: { innerHTML: dialogTitle },
      styles: { margin: "0 0 8px 0" },
    })
    .addCell(1, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "llm-shortcut-label-input" },
      properties: { innerHTML: "Label" },
    })
    .addCell(
      1,
      1,
      {
        tag: "input",
        namespace: "html",
        id: "llm-shortcut-label-input",
        attributes: {
          "data-bind": "labelValue",
          "data-prop": "value",
          type: "text",
        },
        styles: {
          width: "300px",
        },
      },
      false,
    )
    .addCell(2, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "llm-shortcut-prompt-input" },
      properties: { innerHTML: "Prompt" },
    })
    .addCell(
      2,
      1,
      {
        tag: "textarea",
        namespace: "html",
        id: "llm-shortcut-prompt-input",
        attributes: {
          "data-bind": "promptValue",
          "data-prop": "value",
          rows: "6",
        },
        styles: {
          width: "300px",
        },
      },
      false,
    )
    .addButton("Save", "save")
    .addButton("Cancel", "cancel")
    .setDialogData(dialogData)
    .open(dialogTitle);

  addon.data.dialog = dialog;
  await dialogData.unloadLock.promise;
  addon.data.dialog = undefined;

  if (dialogData._lastButtonId !== "save") return null;

  return {
    label: dialogData.labelValue || "",
    prompt: dialogData.promptValue || "",
  };
}

export async function openResetShortcutsDialog(): Promise<boolean> {
  const dialogData: { [key: string]: any } = {
    loadCallback: () => {
      return;
    },
    unloadCallback: () => {
      return;
    },
  };

  const dialog = new ztoolkit.Dialog(1, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      properties: {
        innerHTML: "Reset all prompt presets to default settings?",
      },
      styles: {
        width: "320px",
        lineHeight: "1.45",
      },
    })
    .addButton("Reset", "reset")
    .addButton("Cancel", "cancel")
    .setDialogData(dialogData)
    .open("Reset Prompt Presets");

  addon.data.dialog = dialog;
  await dialogData.unloadLock.promise;
  addon.data.dialog = undefined;
  return dialogData._lastButtonId === "reset";
}
