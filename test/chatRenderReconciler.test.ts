import { assert } from "chai";
import {
  buildChatMessageDomKey,
  patchStreamingChatMessage,
} from "../src/modules/contextPanel/chatRenderReconciler";

class FakeNode {
  childNodes: FakeNode[] = [];
  attributes: { name: string; value: string }[] = [];
  parentNode: FakeNode | null = null;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  nodeType: number;

  constructor(
    readonly nodeName: string,
    public nodeValue: string | null = null,
  ) {
    this.nodeType = nodeName === "#text" ? 3 : 1;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) || null;
  }

  getAttribute(name: string): string | null {
    return (
      this.attributes.find((attribute) => attribute.name === name)?.value ??
      null
    );
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  setAttribute(name: string, value: string): void {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter(
      (attribute) => attribute.name !== name,
    );
  }

  appendChild(child: FakeNode): void {
    child.remove();
    child.parentNode = this;
    this.childNodes.push(child);
  }

  replaceChild(child: FakeNode, prior: FakeNode): void {
    child.remove();
    this.childNodes[this.childNodes.indexOf(prior)] = child;
    prior.parentNode = null;
    child.parentNode = this;
  }

  removeChild(child: FakeNode): void {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
  }

  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.removeChild(this);
  }

  isEqualNode(other: FakeNode): boolean {
    return (
      this.nodeName === other.nodeName &&
      this.namespaceURI === other.namespaceURI &&
      this.nodeValue === other.nodeValue &&
      this.attributes.length === other.attributes.length &&
      this.attributes.every(
        ({ name, value }) => other.getAttribute(name) === value,
      ) &&
      this.childNodes.length === other.childNodes.length &&
      this.childNodes.every((child, index) =>
        child.isEqualNode(other.childNodes[index]),
      )
    );
  }
}

function element(name: string, ...children: (string | FakeNode)[]): FakeNode {
  const node = new FakeNode(name);
  for (const child of children) {
    node.appendChild(
      typeof child === "string" ? new FakeNode("#text", child) : child,
    );
  }
  return node;
}

function patch(current: FakeNode, next: FakeNode): void {
  patchStreamingChatMessage(
    current as unknown as Element,
    next as unknown as Element,
  );
}

describe("chatRenderReconciler", function () {
  it("builds stable DOM keys from index, role, and timestamp", function () {
    assert.equal(
      buildChatMessageDomKey(3, { role: "assistant", timestamp: 1234.9 }),
      "3:assistant:1234",
    );
  });

  it("keeps completed paragraphs and formulas attached while the answer grows", function () {
    const paragraph = element("p", "Completed paragraph.");
    const formula = element("span", "x + y");
    formula.setAttribute("class", "katex");
    const tail = element("p", "New");
    const text = tail.childNodes[0];
    const current = element("div", paragraph, formula, tail);
    const nextFormula = element("span", "x + y");
    nextFormula.setAttribute("class", "katex");
    const next = element(
      "div",
      element("p", "Completed paragraph."),
      nextFormula,
      element("p", "New text"),
    );

    patch(current, next);

    assert.strictEqual(current.childNodes[0], paragraph);
    assert.strictEqual(current.childNodes[1], formula);
    assert.strictEqual(paragraph.parentNode, current);
    assert.strictEqual(formula.parentNode, current);
    assert.strictEqual(tail.childNodes[0], text);
    assert.equal(text.nodeValue, "New text");
    assert.isTrue(current.isEqualNode(next));
  });

  it("reconciles completed Markdown syntax and appends new blocks", function () {
    const current = element("div", element("p", "An **unfinished"));
    const next = element(
      "div",
      element("p", "An ", element("strong", "unfinished")),
      element("pre", element("code", "example")),
    );

    patch(current, next);

    assert.equal(current.childNodes[0].childNodes[1].nodeName, "strong");
    assert.equal(current.childNodes[1].nodeName, "pre");
    assert.equal(current.childNodes[1].parentNode, current);
  });

  it("removes stale streamed content and synchronizes reasoning expansion", function () {
    const current = element(
      "details",
      element("summary", "Thinking"),
      element("p", "Old snapshot"),
      element("p", "Removed"),
    );
    current.setAttribute("open", "");
    current.setAttribute("data-message-render-key", "old");
    const next = element(
      "details",
      element("summary", "Thinking"),
      element("p", "Corrected snapshot"),
    );
    next.setAttribute("data-message-render-key", "new");
    const summary = current.childNodes[0];

    patch(current, next);

    assert.strictEqual(current.childNodes[0], summary);
    assert.isTrue(current.isEqualNode(next));
    assert.isFalse(current.hasAttribute("open"));
  });

  it("replaces elements when a formula changes namespace", function () {
    const html = element("math", "x");
    const math = element("math", "y");
    math.namespaceURI = "http://www.w3.org/1998/Math/MathML";
    const current = element("div", html);

    patch(current, element("div", math));

    assert.strictEqual(current.childNodes[0], math);
    assert.isNull(html.parentNode);
  });
});
