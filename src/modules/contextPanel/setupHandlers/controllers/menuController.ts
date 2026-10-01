export const MODEL_MENU_OPEN_CLASS = "llm-model-menu-open";
export const REASONING_MENU_OPEN_CLASS = "llm-reasoning-menu-open";
export const RETRY_MODEL_MENU_OPEN_CLASS = "llm-model-menu-open";
export const ADD_MENU_OPEN_CLASS = "llm-add-menu-open";

export function setFloatingMenuOpen(
  menu: HTMLDivElement | null,
  openClass: string,
  isOpen: boolean,
): void {
  if (!menu) return;
  if (isOpen) {
    menu.style.display = "grid";
    menu.classList.add(openClass);
    return;
  }
  menu.classList.remove(openClass);
  menu.style.display = "none";
}

export function isFloatingMenuOpen(menu: HTMLDivElement | null): boolean {
  return Boolean(menu && menu.style.display !== "none");
}

export function positionFloatingMenu(
  owner: Element,
  menu: HTMLDivElement,
  anchor: HTMLButtonElement,
  placement: "above" | "below" = "below",
): void {
  const win = owner.ownerDocument?.defaultView;
  if (!win) return;

  const viewportMargin = 8;
  const gap = 6;
  const ownerRect = owner.getBoundingClientRect();
  const hasOwnerBounds = ownerRect.width > 0 && ownerRect.height > 0;
  const boundaryLeft = hasOwnerBounds
    ? Math.max(viewportMargin, ownerRect.left + viewportMargin)
    : viewportMargin;
  const boundaryTop = hasOwnerBounds
    ? Math.max(viewportMargin, ownerRect.top + viewportMargin)
    : viewportMargin;
  const boundaryRight = hasOwnerBounds
    ? Math.min(
        win.innerWidth - viewportMargin,
        ownerRect.right - viewportMargin,
      )
    : win.innerWidth - viewportMargin;
  const boundaryBottom = hasOwnerBounds
    ? Math.min(
        win.innerHeight - viewportMargin,
        ownerRect.bottom - viewportMargin,
      )
    : win.innerHeight - viewportMargin;
  const availableWidth = Math.max(120, boundaryRight - boundaryLeft);
  const availableHeight = Math.max(120, boundaryBottom - boundaryTop);

  menu.style.position = "fixed";
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.display = "grid";
  menu.style.visibility = "hidden";
  menu.style.maxWidth = `${availableWidth}px`;
  menu.style.maxHeight = `${availableHeight}px`;
  menu.style.boxSizing = "border-box";
  menu.style.overflowY = "auto";
  menu.style.overflowX = "hidden";

  const anchorRect = anchor.getBoundingClientRect();
  const spaceAbove = Math.max(0, anchorRect.top - gap - boundaryTop);
  const spaceBelow = Math.max(0, boundaryBottom - anchorRect.bottom - gap);
  const naturalHeight = menu.getBoundingClientRect().height;
  const openAbove =
    placement === "above"
      ? spaceAbove >= naturalHeight || spaceAbove >= spaceBelow
      : spaceBelow < naturalHeight && spaceAbove > spaceBelow;
  menu.style.maxHeight = `${openAbove ? spaceAbove : spaceBelow}px`;
  const menuRect = menu.getBoundingClientRect();

  let left = anchorRect.left;
  const maxLeft = Math.max(boundaryLeft, boundaryRight - menuRect.width);
  left = Math.min(Math.max(boundaryLeft, left), maxLeft);

  const top = openAbove
    ? anchorRect.top - gap - menuRect.height
    : anchorRect.bottom + gap;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(Math.max(boundaryTop, top))}px`;
  menu.style.visibility = "visible";
}
