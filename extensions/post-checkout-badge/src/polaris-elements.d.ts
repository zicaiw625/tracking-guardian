import type { ComponentChildren } from "preact";

declare module "preact/src/jsx" {
  namespace JSXInternal {
    interface IntrinsicElements {
      "s-stack": {
        direction?: "block" | "inline";
        children?: ComponentChildren;
      };
      "s-banner": {
        heading?: string;
        children?: ComponentChildren;
      };
      "s-text": {
        children?: ComponentChildren;
      };
      "s-link": {
        href?: string;
        children?: ComponentChildren;
      };
    }
  }
}

declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      "s-stack": {
        direction?: "block" | "inline";
        children?: ComponentChildren;
      };
      "s-banner": {
        heading?: string;
        children?: ComponentChildren;
      };
      "s-text": {
        children?: ComponentChildren;
      };
      "s-link": {
        href?: string;
        children?: ComponentChildren;
      };
    }
  }
}

export {};
