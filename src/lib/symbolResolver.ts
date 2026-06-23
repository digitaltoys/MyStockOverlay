import { fetch as httpFetch } from "@tauri-apps/plugin-http";

export interface ResolvedSymbolCandidate {
  symbol: string;
  displayName: string;
  source: "existing" | "krx";
}

const SYMBOL_LIKE_PATTERN = /^[A-Za-z0-9.\-]{1,12}$/;
const KRX_AUTOCOMPLETE_URL = "https://kind.krx.co.kr/common/akc.jsp";
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

function parseKrxAutocompletePayload(content: string): ResolvedSymbolCandidate[] {
  const keywordMatch = content.match(/var myJSONObject = (\{.*?\});/s);
  const codeMatch = content.match(/var myJSONObject2 = (\{.*?\});/s);

  if (!keywordMatch || !codeMatch) return [];

  try {
    const keywordJson = JSON.parse(keywordMatch[1]) as { LIST?: Array<{ KEYWORD?: string }> };
    const codeJson = JSON.parse(codeMatch[1]) as { LIST?: Array<{ NUM?: string }> };
    const keywords = keywordJson.LIST ?? [];
    const codes = codeJson.LIST ?? [];
    const max = Math.min(keywords.length, codes.length);
    const candidates: ResolvedSymbolCandidate[] = [];

    for (let i = 0; i < max; i++) {
      const displayName = keywords[i]?.KEYWORD?.trim();
      const symbol = codes[i]?.NUM?.trim();
      if (!displayName || !symbol) continue;
      candidates.push({
        symbol,
        displayName,
        source: "krx",
      });
    }

    return dedupeCandidates(candidates);
  } catch {
    return [];
  }
}

async function searchKrxAutocomplete(query: string): Promise<ResolvedSymbolCandidate[]> {
  const cached = candidateCache.get(query);
  if (cached) return cached;

  const url = `${KRX_AUTOCOMPLETE_URL}?aa=test&q=${encodeURIComponent(query)}&s=2`;
  const response = await httpFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/javascript,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`KRX 자동완성 검색 실패: HTTP ${response.status}`);
  }

  const text = await response.text();
  const candidates = parseKrxAutocompletePayload(text);

  const ranked = rankCandidates(query, candidates);
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

  const searchResults = await searchKrxAutocomplete(trimmed);
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
