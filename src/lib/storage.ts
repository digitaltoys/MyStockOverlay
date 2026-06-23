/**
 * storage.ts
 * 앱의 모든 localStorage 접근을 단일 인터페이스로 통합 관리합니다.
 *
 * 저장 키:
 *   - "mystockoverlay_config" : 앱 전체 설정 (AppConfig)
 *   - "kis_auth"              : KIS API 인증 토큰 (KisAuth)
 */

// ─── 타입 정의 ────────────────────────────────────────────────────

export interface TickerPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface StockPurchase {
  price: number;   // 매입가 (원)
  qty: number;     // 수량
}

export interface MyStock {
  symbol: string;
  purchases: StockPurchase[];  // 매입 이력
}

export type DataSourceMode = "real" | "virtual" | "yahoo" | "toss";

export interface ApisConfig {
  kis: {
    appKey: string;
    appSecret: string;
  };
  kisVirtual: {
    appKey: string;
    appSecret: string;
  };
  toss: {
    clientId: string;
    clientSecret: string;
  };
}

export interface AppConfig {
  apis: ApisConfig;
  dataSourceMode: DataSourceMode;
  tossPollingIntervalSec: number;
  hideBorder: boolean;
  isLocked: boolean;
  symbols: string[];
  activeSymbols: string[];
  tickers: Record<string, TickerPosition>;
  scale: number;
  myStocks: MyStock[];  // 내 주식 매입 이력
}

export interface KisAuth {
  accessToken: string;
  tokenTime: number; // Date.now()
}

export interface TossAuth {
  accessToken: string;
  tokenTime: number; // Date.now()
}

// ─── 기본값 ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  apis: {
    kis: { appKey: "", appSecret: "" },
    kisVirtual: { appKey: "", appSecret: "" },
    toss: { clientId: "", clientSecret: "" },
  },
  dataSourceMode: "real",
  tossPollingIntervalSec: 10,
  hideBorder: false,
  isLocked: true,
  symbols: [],
  activeSymbols: [],
  tickers: {},
  scale: 1.0,
  myStocks: [],
};

// ─── 저수준 헬퍼 ───────────────────────────────────────────────────

const CONFIG_KEY = "mystockoverlay_config";
const AUTH_KEY = "kis_auth";

// ─── AppConfig 전체 읽기/쓰기 ──────────────────────────────────────

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    
    const parsed = JSON.parse(raw);
    
    // 마이그레이션 로직: apis 키가 없으면 이전 버전들(Flat 또는 V1)임
    if (!parsed.apis) {
      console.log("[Storage] Migrating old config (Flat or V1) to apis subkey structure (V2)...");
      const legacyWantedYahoo = parsed.fallback?.enabled ?? parsed.enableFallback ?? false;
      const legacyWantedVirtual = parsed.kis?.isVirtual ?? parsed.isVirtual ?? false;
      const legacyMode: DataSourceMode =
        parsed.dataSourceMode ??
        (legacyWantedYahoo ? "yahoo" : legacyWantedVirtual ? "virtual" : "real");
      
      const migrated: AppConfig = {
        ...DEFAULT_CONFIG,
        hideBorder: parsed.hideBorder ?? DEFAULT_CONFIG.hideBorder,
        isLocked: parsed.isLocked ?? DEFAULT_CONFIG.isLocked,
        scale: parsed.scale ?? DEFAULT_CONFIG.scale,
        tossPollingIntervalSec: parsed.tossPollingIntervalSec ?? DEFAULT_CONFIG.tossPollingIntervalSec,
        symbols: parsed.symbols ?? DEFAULT_CONFIG.symbols,
        activeSymbols: parsed.activeSymbols ?? DEFAULT_CONFIG.activeSymbols,
        tickers: parsed.tickers ?? DEFAULT_CONFIG.tickers,
        dataSourceMode: legacyMode,
        apis: {
          kis: {
            appKey: parsed.kis?.realAppKey ?? parsed.realAppKey ?? parsed.appKey ?? "",
            appSecret: parsed.kis?.realAppSecret ?? parsed.realAppSecret ?? parsed.appSecret ?? "",
          },
          kisVirtual: {
            appKey: parsed.kis?.virtualAppKey ?? parsed.virtualAppKey ?? "",
            appSecret: parsed.kis?.virtualAppSecret ?? parsed.virtualAppSecret ?? "",
          },
          toss: {
            clientId: parsed.toss?.clientId ?? parsed.toss?.client_id ?? "",
            clientSecret: parsed.toss?.clientSecret ?? parsed.toss?.client_secret ?? "",
          },
        }
      };
      
      // 마이그레이션 결과 즉시 저장
      localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated));
      return migrated;
    }

    // myStocks 필드 마이그레이션 (이전 버전에 없을 수 있음)
    if (!parsed.myStocks) parsed.myStocks = [];
    if (typeof parsed.tossPollingIntervalSec !== "number") {
      parsed.tossPollingIntervalSec = DEFAULT_CONFIG.tossPollingIntervalSec;
    }
    if (!parsed.dataSourceMode) {
      parsed.dataSourceMode = parsed.fallback?.enabled || parsed.enableFallback
        ? "yahoo"
        : parsed.isVirtual
          ? "virtual"
          : "real";
    }

    parsed.apis = {
      ...DEFAULT_CONFIG.apis,
      ...parsed.apis,
      kis: {
        ...DEFAULT_CONFIG.apis.kis,
        ...parsed.apis?.kis,
      },
      kisVirtual: {
        ...DEFAULT_CONFIG.apis.kisVirtual,
        ...parsed.apis?.kisVirtual,
      },
      toss: {
        ...DEFAULT_CONFIG.apis.toss,
        ...parsed.apis?.toss,
      },
    };

    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  
  // apis 객체는 내부 필드가 유실되지 않도록 특별히 병합 처리
  const nextApis = partial.apis 
    ? { ...current.apis, ...partial.apis } 
    : current.apis;

  const next = { 
    ...current, 
    ...partial, 
    apis: nextApis 
  };
  
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

// ─── 편의 헬퍼: 개별 필드 접근 ────────────────────────────────────

export const Config = {
  /** 전체 설정 로드 */
  get: loadConfig,

  /** 부분 업데이트 */
  set: saveConfig,

  /** 티커 창 위치 저장 */
  setTickerPos(symbol: string, pos: TickerPosition): void {
    const config = loadConfig();
    config.tickers[symbol] = pos;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  },

  /** 티커 창 위치 조회 */
  getTickerPos(symbol: string): TickerPosition | null {
    return loadConfig().tickers[symbol] ?? null;
  },

  /** 활성 종목 목록에서 추가 */
  addActiveSymbol(symbol: string): void {
    const config = loadConfig();
    if (!config.activeSymbols.includes(symbol)) {
      config.activeSymbols = [...config.activeSymbols, symbol];
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
  },

  /** 활성 종목 목록에서 제거 */
  removeActiveSymbol(symbol: string): void {
    const config = loadConfig();
    config.activeSymbols = config.activeSymbols.filter(s => s !== symbol);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  },

  /** 활성 종목 전체 교체 */
  setActiveSymbols(symbols: string[]): void {
    saveConfig({ activeSymbols: symbols });
  },

  /** 데이터 소스 모드 저장 */
  setDataSourceMode(mode: DataSourceMode): void {
    saveConfig({ dataSourceMode: mode });
  },

  setTossPollingIntervalSec(interval: number): void {
    const safe = Math.max(3, Math.min(60, Math.round(interval)));
    saveConfig({ tossPollingIntervalSec: safe });
  },

  getTossPollingIntervalSec(): number {
    return loadConfig().tossPollingIntervalSec;
  },

  /** 현재 데이터 소스 모드 조회 */
  getDataSourceMode(): DataSourceMode {
    return loadConfig().dataSourceMode;
  },

  /**
   * 현재 모드(실/모의)에 맞는 App Key & Secret 반환.
   */
  getActiveKeys(): { appKey: string; appSecret: string } {
    const c = loadConfig();
    if (c.dataSourceMode === "virtual") {
      return {
        appKey: c.apis.kisVirtual.appKey,
        appSecret: c.apis.kisVirtual.appSecret,
      };
    }
    if (c.dataSourceMode === "real") {
      return {
        appKey: c.apis.kis.appKey,
        appSecret: c.apis.kis.appSecret,
      };
    }
    if (c.dataSourceMode === "toss") {
      return {
        appKey: c.apis.toss.clientId,
        appSecret: c.apis.toss.clientSecret,
      };
    }
    return { appKey: "", appSecret: "" };
  },
};

// ─── KIS 인증 토큰 ─────────────────────────────────────────────────

export const KisAuthStorage = {
  get(isVirtual: boolean = false): KisAuth | null {
    const key = isVirtual ? "kis_auth_virtual" : AUTH_KEY;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as KisAuth;
    } catch {
      return null;
    }
  },

  set(auth: KisAuth, isVirtual: boolean = false): void {
    const key = isVirtual ? "kis_auth_virtual" : AUTH_KEY;
    localStorage.setItem(key, JSON.stringify(auth));
  },

  clear(isVirtual?: boolean): void {
    if (isVirtual === undefined) {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem("kis_auth_virtual");
    } else {
      const key = isVirtual ? "kis_auth_virtual" : AUTH_KEY;
      localStorage.removeItem(key);
    }
  },
};

export const TossAuthStorage = {
  get(): TossAuth | null {
    try {
      const raw = localStorage.getItem("toss_auth");
      if (!raw) return null;
      return JSON.parse(raw) as TossAuth;
    } catch {
      return null;
    }
  },

  set(auth: TossAuth): void {
    localStorage.setItem("toss_auth", JSON.stringify(auth));
  },

  clear(): void {
    localStorage.removeItem("toss_auth");
  },
};
