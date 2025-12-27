import type { SVGProps } from "react";
import type { IconSource } from "@shopify/polaris";

const createIcon = (path: string): IconSource => {
  const IconComponent = (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path d={path} />
    </svg>
  );

  return IconComponent;
};

export const ArrowUpIcon: IconSource = createIcon(
  "M10 3l5 5h-3v7H8V8H5l5-5z",
);

export const ArrowDownIcon: IconSource = createIcon(
  "M10 17l-5-5h3V5h4v7h3l-5 5z",
);

export const MinusIcon: IconSource = createIcon("M4 9h12v2H4z");

export const CheckCircleIcon: IconSource = createIcon(
  "M10 2a8 8 0 100 16 8 8 0 000-16zm3.03 5.97l-4.24 4.24-1.82-1.82-1.06 1.06 2.88 2.88 5.3-5.3-1.06-1.06z",
);

export const AlertCircleIcon: IconSource = createIcon(
  "M10 2a8 8 0 100 16 8 8 0 000-16zm0 4a1 1 0 011 1v4a1 1 0 01-2 0V7a1 1 0 011-1zm0 8.75a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z",
);

export const SettingsIcon: IconSource = createIcon(
  "M10 4a1 1 0 011 1v1.09a4 4 0 011.56.65l.77-.77a1 1 0 111.41 1.41l-.77.77c.3.48.52 1 .65 1.56H16a1 1 0 110 2h-1.09a4 4 0 01-.65 1.56l.77.77a1 1 0 11-1.41 1.41l-.77-.77a4 4 0 01-1.56.65V16a1 1 0 11-2 0v-1.09a4 4 0 01-1.56-.65l-.77.77a1 1 0 11-1.41-1.41l.77-.77A4 4 0 014.09 11H3a1 1 0 110-2h1.09a4 4 0 01.65-1.56l-.77-.77a1 1 0 111.41-1.41l.77.77c.48-.3 1-.52 1.56-.65V5a1 1 0 011-1zm0 4a2 2 0 100 4 2 2 0 000-4z",
);

export const LockIcon: IconSource = createIcon(
  "M7 8V6a3 3 0 116 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H6a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a1 1 0 112 0v2H9V6z",
);

export const LockFilledIcon: IconSource = createIcon(
  "M7 8V6a3 3 0 116 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H6a1 1 0 01-1-1V9a1 1 0 011-1h1zm3 3a1 1 0 100 2 1 1 0 000-2z",
);

export const SearchIcon: IconSource = createIcon(
  "M11.5 3a4.5 4.5 0 11-2.93 7.94l-3.8 3.8-1.06-1.06 3.8-3.8A4.5 4.5 0 0111.5 3zm0 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
);

export const RefreshIcon: IconSource = createIcon(
  "M4 10a6 6 0 019.5-4.77V3h2v5h-5V6h2.5A4 4 0 106 10H4z",
);

export const ClockIcon: IconSource = createIcon(
  "M10 2a8 8 0 100 16 8 8 0 000-16zm.75 4.5v3.44l2.72 1.63-.75 1.23L9 11V6.5h1.75z",
);

export const ArrowRightIcon: IconSource = createIcon(
  "M5 10a1 1 0 011-1h5.59L10.3 7.7a1 1 0 111.4-1.4l4 4-4 4a1 1 0 01-1.4-1.4l1.29-1.3H6a1 1 0 01-1-1z",
);

export const ClipboardIcon: IconSource = createIcon(
  "M8.5 3h3a1 1 0 011 1H15a1 1 0 011 1v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1h2.5a1 1 0 011-1zm-.5 4v1h4V7H8zm0 3v1h4v-1H8zm0 3v1h4v-1H8z",
);

export const InfoIcon: IconSource = createIcon(
  "M10 2a8 8 0 100 16 8 8 0 000-16zm1 5h-2V5h2v2zm0 2v6h-2V9h2z",
);

export const DeleteIcon: IconSource = createIcon(
  "M7 4h6l-.5-1h-5L7 4zm9 2H4v1h1v8a2 2 0 002 2h6a2 2 0 002-2V7h1V6zm-3 1v8H7V7h6z",
);

export const ExportIcon: IconSource = createIcon(
  "M10 2l3 3h-2v5H9V5H7l3-3zM5 10h2v6h6v-6h2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6z",
);

export const ShareIcon: IconSource = createIcon(
  "M14 6a2 2 0 10-1.53.72L8.9 8.9a2 2 0 100 2.2l3.57 2.18A2 2 0 1014 12a2 2 0 00-.12-.68l-3.68-2.25a2.01 2.01 0 000-.14l3.68-2.25A2 2 0 0014 6z",
);

export const PlayIcon: IconSource = createIcon(
  "M6 4l10 6-10 6V4z",
);

export const PauseIcon: IconSource = createIcon(
  "M6 4h3v12H6V4zm5 0h3v12h-3V4z",
);

export const StopIcon: IconSource = createIcon(
  "M5 5h10v10H5V5z",
);
