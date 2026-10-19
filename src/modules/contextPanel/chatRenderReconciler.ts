import type { Message } from "./types";

export type ChatRenderedMessageState = {
  domKey: string;
  renderKey: string;
};

export function buildChatMessageDomKey(
  index: number,
  message: Pick<Message, "role" | "timestamp">,
): string {
  return `${index}:${message.role}:${Math.floor(Number(message.timestamp) || 0)}`;
}

// The caller must keep the same message object so retained listeners stay valid.
export function patchStreamingChatMessage(
  current: Element,
  next: Element,
): void {
  for (const attribute of Array.from(current.attributes)) {
    if (!next.hasAttribute(attribute.name)) {
      current.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(next.attributes)) {
    if (current.getAttribute(attribute.name) !== attribute.value) {
      current.setAttribute(attribute.name, attribute.value);
    }
  }

  const nextChildren = Array.from(next.childNodes) as Node[];
  for (let index = 0; index < nextChildren.length; index += 1) {
    const child = nextChildren[index];
    const prior = current.childNodes[index];
    if (!prior) {
      current.appendChild(child);
    } else if (prior.isEqualNode(child)) {
      continue;
    } else if (prior.nodeType === 3 && child.nodeType === 3) {
      prior.nodeValue = child.nodeValue;
    } else if (
      prior.nodeType === 1 &&
      child.nodeType === 1 &&
      prior.nodeName === child.nodeName &&
      (prior as Element).namespaceURI === (child as Element).namespaceURI
    ) {
      patchStreamingChatMessage(prior as Element, child as Element);
    } else {
      current.replaceChild(child, prior);
    }
  }
  while (current.childNodes.length > nextChildren.length) {
    current.removeChild(current.lastChild!);
  }
}
