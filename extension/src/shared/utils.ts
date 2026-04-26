import type { HeaderDraft } from "./types";

export function parseHeaderText(raw: string): HeaderDraft[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0) {
        return { name: line, value: "" };
      }

      return {
        name: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

export function headersToText(headers: HeaderDraft[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

export function getOrigin(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function normalizeOrigins(input: string[] | string): string[] {
  const parts = Array.isArray(input)
    ? input
    : input
        .split(/\r?\n|,/u)
        .map((value) => value.trim())
        .filter(Boolean);

  const uniqueOrigins = new Set<string>();
  for (const part of parts) {
    try {
      uniqueOrigins.add(new URL(part).origin);
    } catch {
      continue;
    }
  }

  return Array.from(uniqueOrigins);
}

export function requestPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}
