import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import type { AppConfig, TossAuth } from "../../storage";
import { TossAuthStorage } from "../../storage";
import { ChartCacheManager } from "../../chartCache";
import type { ChartPoint, StockData } from "../../types";
import { BaseProvider } from "../base/BaseProvider";
import { isIndexSymbol } from "../../market";

const TOSS_API_BASE = "https://openapi.tossinvest.com";
const TOSS_DISPLAY_NAME_TTL_MS = 24 * 60 * 60 * 1000;
const TOSS_BASE_PRICE_TTL_MS = 6 * 60 * 60 * 1000;

type TossCachedValue<T> = {
  value: T;
  cachedAt: number;
};

const tossDisplayNameCache = new Map<string, TossCachedValue<string>>();
const tossBasePriceCache = new Map<string, TossCachedValue<number>>();

interface TossTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

interface TossPriceItem {
  symbol: string;
  timestamp: string | null;
  lastPrice: string;
  currency: string;
}

interface TossStockInfo {
  symbol: string;
  name: string;
  englishName?: string;
}

interface TossCandleItem {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

interface TossCandlePage {
  candles: TossCandleItem[];
  nextBefore: string | null;
}

interface TossApiEnvelope<T> {
  result?: T;
  error?: {
    requestId?: string;
    code?: string;
    message?: string;
    data?: unknown;
  } | string;
}

export class TossProvider extends BaseProvider {
  readonly mode = "toss" as const;
  readonly name = "Toss" as const;

  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  private getCredentials() {
    const { clientId, clientSecret } = this.config.apis.toss;
    if (!clientId || !clientSecret) {
      throw new Error("토스 client_id/client_secret이 설정되지 않았습니다.");
    }
    return { clientId, clientSecret };
  }

  private ensureSupportedSymbol(symbol: string) {
    if (isIndexSymbol(symbol)) {
      throw new Error(`[Toss] 지수 종목은 지원하지 않습니다: ${symbol}`);
    }
  }

  private async parseResponse<T>(response: Response, context: string): Promise<T> {
    const text = await response.text();
    let parsed: TossApiEnvelope<T> | TossTokenResponse | any = null;

    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`[Toss] ${context} 응답 파싱 실패: ${text.slice(0, 120)}`);
      }
    }

    if (!response.ok) {
      const message = this.formatErrorMessage(response.status, parsed, context);
      throw new Error(message);
    }

    return ((parsed as TossApiEnvelope<T>)?.result ?? parsed) as T;
  }

  private getCachedValue<T>(cache: Map<string, TossCachedValue<T>>, symbol: string, ttlMs: number): T | null {
    const cached = cache.get(symbol);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > ttlMs) {
      cache.delete(symbol);
      return null;
    }
    return cached.value;
  }

  private setCachedValue<T>(cache: Map<string, TossCachedValue<T>>, symbol: string, value: T): T {
    cache.set(symbol, { value, cachedAt: Date.now() });
    return value;
  }

  private formatErrorMessage(status: number, parsed: any, context: string): string {
    if (parsed?.error) {
      if (typeof parsed.error === "string") {
        return `[Toss] ${context} 실패: ${parsed.error}${parsed.error_description ? ` - ${parsed.error_description}` : ""}`;
      }

      const code = parsed.error.code ?? parsed.error.error ?? "unknown";
      const message = parsed.error.message ?? parsed.error.error_description ?? "알 수 없는 오류";
      return `[Toss] ${context} 실패: ${code} - ${message}`;
    }

    if (parsed?.message) {
      return `[Toss] ${context} 실패: ${parsed.message}`;
    }

    return `[Toss] ${context} 실패: HTTP ${status}`;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
      body?: string;
      requiresAuth?: boolean;
      retryAuth?: boolean;
      retryRateLimit?: boolean;
      context: string;
    },
  ): Promise<T> {
    const url = new URL(`${TOSS_API_BASE}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };

    if (options.requiresAuth ?? true) {
      headers.Authorization = `Bearer ${await this.getAccessToken()}`;
    }

    const response = await httpFetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    });

    if ((options.requiresAuth ?? true) && !options.retryAuth && (response.status === 401 || response.status === 403)) {
      await this.getAccessToken(true);
      return this.request<T>(path, {
        ...options,
        retryAuth: true,
      });
    }

    if (!options.retryRateLimit && response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 1500;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return this.request<T>(path, {
        ...options,
        retryRateLimit: true,
      });
    }

    return this.parseResponse<T>(response, options.context);
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (this.tokenPromise) return this.tokenPromise;

    const cached = TossAuthStorage.get();

    if (!forceRefresh && cached) {
      const age = Date.now() - cached.tokenTime;
      if (age < 23 * 60 * 60 * 1000) {
        return cached.accessToken;
      }
    }

    const { clientId, clientSecret } = this.getCredentials();

    this.tokenPromise = (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }).toString();

        const response = await httpFetch(`${TOSS_API_BASE}/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
        });

        const token = await this.parseResponse<TossTokenResponse>(response, "토큰 발급");
        if (!token?.access_token) {
          throw new Error("[Toss] 토큰 발급 응답에 access_token이 없습니다.");
        }

        const auth: TossAuth = {
          accessToken: token.access_token,
          tokenTime: Date.now(),
        };
        TossAuthStorage.set(auth);
        return token.access_token;
      } catch (error: any) {
        console.error("[Toss] 토큰 발급 실패:", error);
        throw error;
      } finally {
        this.tokenPromise = null;
      }
    })();

    return this.tokenPromise;
  }

  private async fetchPriceItems(symbol: string): Promise<TossPriceItem[]> {
    return this.request<TossPriceItem[]>("/api/v1/prices", {
      method: "GET",
      query: { symbols: symbol },
      context: "현재가 조회",
    });
  }

  private async fetchDisplayName(symbol: string): Promise<string> {
    const cached = this.getCachedValue(tossDisplayNameCache, symbol, TOSS_DISPLAY_NAME_TTL_MS);
    if (cached) return cached;

    try {
      const stocks = await this.request<TossStockInfo[]>("/api/v1/stocks", {
        method: "GET",
        query: { symbols: symbol },
        context: "종목 정보 조회",
      });

      const info = stocks[0];
      const displayName = info?.name ?? info?.englishName ?? symbol;
      return this.setCachedValue(tossDisplayNameCache, symbol, displayName);
    } catch (error) {
      console.warn(`[Toss] 종목명 조회 실패(${symbol}), 심볼을 그대로 사용합니다.`, error);
      return symbol;
    }
  }

  private async fetchBasePrice(symbol: string): Promise<number> {
    const cached = this.getCachedValue(tossBasePriceCache, symbol, TOSS_BASE_PRICE_TTL_MS);
    if (cached && cached > 0) return cached;

    const page = await this.request<TossCandlePage>("/api/v1/candles", {
      method: "GET",
      query: {
        symbol,
        interval: "1d",
        count: 2,
        adjusted: true,
      },
      context: "일봉 조회",
    });

    const referenceCandle = page.candles?.[1] ?? page.candles?.[0];
    const basePrice = Number(referenceCandle?.closePrice ?? 0);
    if (Number.isFinite(basePrice) && basePrice > 0) {
      return this.setCachedValue(tossBasePriceCache, symbol, basePrice);
    }

    return 0;
  }

  private async fetchMinuteCandles(symbol: string): Promise<TossCandleItem[]> {
    const all: TossCandleItem[] = [];
    let before: string | undefined;

    for (let page = 0; page < 3; page++) {
      const data = await this.request<TossCandlePage>("/api/v1/candles", {
        method: "GET",
        query: {
          symbol,
          interval: "1m",
          count: 200,
          before,
          adjusted: true,
        },
        context: "분봉 조회",
      });

      const candles = data.candles ?? [];
      if (candles.length === 0) break;

      all.push(...candles);
      if (!data.nextBefore) break;
      before = data.nextBefore;
    }

    const unique = new Map<string, TossCandleItem>();
    for (const candle of all) {
      unique.set(candle.timestamp, candle);
    }

    return Array.from(unique.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private candleToChartPoint(candle: TossCandleItem): ChartPoint {
    const normalized = candle.timestamp.replace(/\.\d+/, "");
    const [datePart, timePart] = normalized.split("T");
    return {
      price: Number(candle.closePrice),
      date: datePart.replace(/-/g, ""),
      hour: timePart.slice(0, 8).replace(/:/g, ""),
    };
  }

  async fetchPrice(symbol: string): Promise<StockData> {
    this.ensureSupportedSymbol(symbol);

    const [priceItems, displayName] = await Promise.all([
      this.fetchPriceItems(symbol),
      this.fetchDisplayName(symbol),
    ]);

    const priceItem = priceItems[0];
    if (!priceItem) {
      throw new Error(`[Toss] 현재가 데이터가 없습니다: ${symbol}`);
    }

    const currentPrice = Number(priceItem.lastPrice);
    if (!Number.isFinite(currentPrice)) {
      throw new Error(`[Toss] 현재가 숫자 변환 실패: ${symbol}`);
    }

    const cachedBasePrice = ChartCacheManager.getBasePrice(symbol);
    const basePrice = cachedBasePrice && cachedBasePrice > 0 ? cachedBasePrice : currentPrice;
    const safeBasePrice = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : currentPrice;
    const changeRate = safeBasePrice > 0 ? ((currentPrice - safeBasePrice) / safeBasePrice) * 100 : 0;

    if (safeBasePrice > 0) {
      ChartCacheManager.updateBasePrice(symbol, safeBasePrice);
    }

    return {
      symbol,
      displayName,
      currentPrice,
      changeRate: Number(changeRate.toFixed(2)),
      isUp: currentPrice > safeBasePrice,
      isDown: currentPrice < safeBasePrice,
      basePrice: safeBasePrice,
      dataSource: "Toss",
      updatedAt: priceItem.timestamp ? new Date(priceItem.timestamp).getTime() : Date.now(),
      intradayPrices: undefined,
    };
  }

  async fetchChart(symbol: string): Promise<ChartPoint[]> {
    this.ensureSupportedSymbol(symbol);

    const basePrice = await this.fetchBasePrice(symbol);
    const candles = await this.fetchMinuteCandles(symbol);
    const points = candles
      .filter((candle) => Number(candle.closePrice) > 0)
      .map((candle) => this.candleToChartPoint(candle));

    if (points.length > 0) {
      if (basePrice > 0) {
        ChartCacheManager.updateBasePrice(symbol, basePrice);
      }
      return ChartCacheManager.saveMergedItems(symbol, points);
    }

    return points;
  }
}
