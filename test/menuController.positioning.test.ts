import { assert } from "chai";
import { positionFloatingMenu } from "../src/modules/contextPanel/setupHandlers/controllers/menuController";

function layout(anchorTop: number, menuHeight: number, menuWidth = 180) {
  const owner = {
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 800 } },
    getBoundingClientRect: () => ({
      left: 600,
      right: 960,
      top: 100,
      bottom: 760,
      width: 360,
      height: 660,
    }),
  } as unknown as Element;
  const anchor = {
    getBoundingClientRect: () => ({
      left: 620,
      right: 648,
      top: anchorTop,
      bottom: anchorTop + 28,
    }),
  } as unknown as HTMLButtonElement;
  const style = { right: "0px", bottom: "100%", maxHeight: "" };
  const menu = {
    style,
    getBoundingClientRect: () => ({
      width: menuWidth,
      height: Math.min(menuHeight, parseFloat(style.maxHeight) || menuHeight),
    }),
  } as unknown as HTMLDivElement;
  positionFloatingMenu(owner, menu, anchor, "above");
  return menu.style;
}

describe("composer menu positioning", function () {
  it("anchors the menu six pixels above the button and clears old container offsets", function () {
    const style = layout(700, 64);
    assert.equal(style.left, "620px");
    assert.equal(style.top, "630px");
    assert.equal(style.bottom, "auto");
    assert.equal(style.right, "auto");
  });

  it("opens below when the button has insufficient space above", function () {
    const style = layout(120, 120);
    assert.equal(style.top, "154px");
  });

  it("scrolls tall menus while retaining the gap and keeps wide menus inside the panel", function () {
    const style = layout(700, 900, 340);
    assert.equal(style.maxHeight, "586px");
    assert.equal(style.top, "108px");
    assert.equal(style.left, "612px");
  });
});
