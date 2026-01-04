/// <reference types="vite/client" />

declare module '@shopify/polaris/build/esm/styles.css?url' {
  const content: string;
  export default content;
}

declare module 'html-pdf-node' {
  interface HtmlPdfNodeOptions {
    format?: 'A4' | 'A3' | 'Letter' | 'Legal';
    margin?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
    printBackground?: boolean;
    landscape?: boolean;
  }

  interface HtmlPdfNodeFile {
    content: string;
  }

  export function generatePdf(
    file: HtmlPdfNodeFile,
    options?: HtmlPdfNodeOptions
  ): Promise<Buffer>;
}

