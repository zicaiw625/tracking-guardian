import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const createRect = (width: number, height: number) => ({
  width,
  height,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  x: 0,
  y: 0,
  toJSON: () => {},
});

// Mock Range methods that might be missing or need specific behavior in JSDOM
Range.prototype.getBoundingClientRect = () => createRect(0, 0) as DOMRect;

Range.prototype.getClientRects = () => ({
  item: () => null,
  length: 0,
  [Symbol.iterator]: function* () {},
}) as unknown as DOMRectList;

Range.prototype.createContextualFragment = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  const fragment = document.createDocumentFragment();
  while (div.firstChild) {
    fragment.appendChild(div.firstChild);
  }
  return fragment;
};

// Mock HTMLElement.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function () {
  return createRect(100, 100) as DOMRect;
};
