import { fetch as httpFetch } from "@tauri-apps/plugin-http";

export interface ResolvedSymbolCandidate {
  symbol: string;
  displayName: string;
  source: "existing" | "naver";
}

const SYMBOL_LIKE_PATTERN = /^[A-Za-z0-9.\-]{1,12}$/;
const NAVER_SEARCH_URL = "https://finance.naver.com/search/searchList.naver";
const candidateCache = new Map<string, ResolvedSymbolCandidate[]>();

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isClearlySymbolLike(input: string): boolean {
  const trimmed = input.trim();
  if (!SYMBOL_LIKE_PATTERN.test(trimmed)) return false;
  if (/[\u3131-\u318E\uAC00-\uD7A3]/.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[.\-0-9]/.test(trimmed)) return true;
  return trimmed === trimmed.toUpperCase();
}

function dedupeCandidates(candidates: ResolvedSymbolCandidate[]): ResolvedSymbolCandidate[] {
  const seen = new Set<string>();
  const next: ResolvedSymbolCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.symbol}|${candidate.displayName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(candidate);
  }
  return next;
}

function rankCandidates(query: string, candidates: ResolvedSymbolCandidate[]): ResolvedSymbolCandidate[] {
  const normalizedQuery = normalizeText(query);
  const exactMatches: ResolvedSymbolCandidate[] = [];
  const prefixMatches: ResolvedSymbolCandidate[] = [];
  const includesMatches: ResolvedSymbolCandidate[] = [];
  const others: ResolvedSymbolCandidate[] = [];

  for (const candidate of candidates) {
    const normalizedName = normalizeText(candidate.displayName);
    if (normalizedName === normalizedQuery) {
      exactMatches.push(candidate);
      continue;
    }
    if (normalizedName.startsWith(normalizedQuery)) {
      prefixMatches.push(candidate);
      continue;
    }
    if (normalizedName.includes(normalizedQuery)) {
      includesMatches.push(candidate);
      continue;
    }
    others.push(candidate);
  }

  return [...exactMatches, ...prefixMatches, ...includesMatches, ...others];
}

async function searchNaverFinance(query: string): Promise<ResolvedSymbolCandidate[]> {
  const cached = candidateCache.get(query);
  if (cached) return cached;

  const url = `${NAVER_SEARCH_URL}?query=${encodeURIComponent(query)}&page=1`;
  const response = await httpFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`네이버 금융 검색 실패: HTTP ${response.status}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = Array.from(doc.querySelectorAll('a[href*="/item/main.naver?code="]'));

  const candidates = links
    .map((link) => {
      const href = link.getAttribute("href") || "";
      const match = href.match(/[?&]code=([A-Za-z0-9.\-]+)/);
      const symbol = match?.[1]?.trim();
      const displayName = link.textContent?.trim().replace(/\s+/g, " ") || "";
      if (!symbol || !displayName) return null;
      return {
        symbol,
        displayName,
        source: "naver" as const,
      };
    })
    .filter(Boolean) as ResolvedSymbolCandidate[];

  const ranked = dedupeCandidates(rankCandidates(query, candidates));
  candidateCache.set(query, ranked);
  return ranked;
}

export async function resolveTickerInput(
  input: string,
  existingNames: Record<string, string> = {},
): Promise<ResolvedSymbolCandidate[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (isClearlySymbolLike(trimmed)) {
    return [
      {
        symbol: trimmed.toUpperCase(),
        displayName: existingNames[trimmed.toUpperCase()] ?? trimmed.toUpperCase(),
        source: "existing",
      },
    ];
  }

  const normalizedQuery = normalizeText(trimmed);
  const existingMatches = Object.entries(existingNames)
    .filter(([, displayName]) => normalizeText(displayName) === normalizedQuery)
    .map(([symbol, displayName]) => ({
      symbol,
      displayName,
      source: "existing" as const,
    }));

  if (existingMatches.length > 0) {
    return existingMatches;
  }

  const searchResults = await searchNaverFinance(trimmed);
  if (searchResults.length > 0) {
    return searchResults;
  }

  if (isClearlySymbolLike(trimmed)) {
    return [
      {
        symbol: trimmed.toUpperCase(),
        displayName: existingNames[trimmed.toUpperCase()] ?? trimmed.toUpperCase(),
        source: "existing",
      },
    ];
  }

  return [];
}
