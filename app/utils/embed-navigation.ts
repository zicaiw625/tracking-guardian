export function withEmbeddedAppParams(path: string, currentSearch: string): string {
  const [pathname, existingQuery = ""] = path.split("?");
  const targetParams = new URLSearchParams(existingQuery);
  const currentParams = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);

  for (const key of ["host", "shop"]) {
    const value = currentParams.get(key);
    if (value && !targetParams.has(key)) {
      targetParams.set(key, value);
    }
  }

  const query = targetParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}
