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

export interface ApisConfig {
  kis: {
    appKey: string;
    appSecret: string;
  };
  kisVirtual: {
    appKey: string;
    appSecret: string;
  };
  yahoo: {
    enabled: boolean;
  };
}

export interface AppConfig {
  apis: ApisConfig;
  isVirtual: boolean;   // KIS의 실계좌/모의투자 모드 결정
  kisEnabled: boolean;  // KIS API 사용 여부 (REST/WS 공통)
  hideBorder: boolean;
  isLocked: boolean;
  symbols: string[];
  activeSymbols: string[];
  tickers: Record<string, TickerPosition>;
  scale: number;
}

export interface KisAuth {
  accessToken: string;
  tokenTime: number; // Date.now()
}

// ─── 기본값 ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  apis: {
    kis: { appKey: "", appSecret: "" },
    kisVirtual: { appKey: "", appSecret: "" },
    yahoo: { enabled: true },
  },
  isVirtual: true,
  kisEnabled: true,
  hideBorder: false,
  isLocked: true,
  symbols: [],
  activeSymbols: [],
  tickers: {},
  scale: 1.0,
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
      
      const migrated: AppConfig = {
        ...DEFAULT_CONFIG,
        hideBorder: parsed.hideBorder ?? DEFAULT_CONFIG.hideBorder,
        isLocked: parsed.isLocked ?? DEFAULT_CONFIG.isLocked,
        scale: parsed.scale ?? DEFAULT_CONFIG.scale,
        symbols: parsed.symbols ?? DEFAULT_CONFIG.symbols,
        activeSymbols: parsed.activeSymbols ?? DEFAULT_CONFIG.activeSymbols,
        tickers: parsed.tickers ?? DEFAULT_CONFIG.tickers,
        // KIS 활성화 및 가상 모드 상태 추출
        isVirtual: parsed.kis?.isVirtual ?? parsed.isVirtual ?? DEFAULT_CONFIG.isVirtual,
        kisEnabled: parsed.kis?.enabled ?? parsed.enableKis ?? DEFAULT_CONFIG.kisEnabled,
        apis: {
          kis: {
            appKey: parsed.kis?.realAppKey ?? parsed.realAppKey ?? parsed.appKey ?? "",
            appSecret: parsed.kis?.realAppSecret ?? parsed.realAppSecret ?? parsed.appSecret ?? "",
          },
          kisVirtual: {
            appKey: parsed.kis?.virtualAppKey ?? parsed.virtualAppKey ?? "",
            appSecret: parsed.kis?.virtualAppSecret ?? parsed.virtualAppSecret ?? "",
          },
          yahoo: {
            enabled: parsed.fallback?.enabled ?? parsed.enableFallback ?? DEFAULT_CONFIG.apis.yahoo.enabled,
          }
        }
      };
      
      // 마이그레이션 결과 즉시 저장
      localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated));
      return migrated;
    }

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

  /**
   * 현재 모드(실/모의)에 맞는 App Key & Secret 반환.
   * 새 필드가 비어있으면 레거시 appKey/appSecret으로 폴백.
   */
  getActiveKeys(): { appKey: string; appSecret: string } {
    const c = loadConfig();
    if (c.isVirtual) {
      return {
        appKey: c.apis.kisVirtual.appKey,
        appSecret: c.apis.kisVirtual.appSecret,
      };
    }
    return {
      appKey: c.apis.kis.appKey,
      appSecret: c.apis.kis.appSecret,
    };
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
