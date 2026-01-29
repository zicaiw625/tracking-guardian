export function sanitizeScriptTagUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") {
    return "";
  }
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

export function sanitizeScriptTags<T extends { src?: string | null }>(scriptTags: T[]): Array<T & { src: string }> {
  return scriptTags.map(tag => ({
    ...tag,
    src: sanitizeScriptTagUrl(tag.src),
  })) as Array<T & { src: string }>;
}
