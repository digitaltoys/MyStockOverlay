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

export interface AppConfig {
  // [deprecated] 하위 호환용. 신규 필드 없을 때 폴백으로 사용
  appKey: string;
  appSecret: string;
  // 실계좌 키
  realAppKey: string;
  realAppSecret: string;
  // 모의투자 키
  virtualAppKey: string;
  virtualAppSecret: string;
  hideBorder: boolean;
  isLocked: boolean;
  symbols: string[];
  activeSymbols: string[];
  tickers: Record<string, TickerPosition>;
  scale: number;
  enableKis: boolean;
  enableFallback: boolean;
  isVirtual: boolean;
}

export interface KisAuth {
  accessToken: string;
  tokenTime: number; // Date.now()
}

// ─── 기본값 ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  appKey: "",
  appSecret: "",
  realAppKey: "",
  realAppSecret: "",
  virtualAppKey: "",
  virtualAppSecret: "",
  hideBorder: false,
  isLocked: true,
  symbols: [],
  activeSymbols: [],
  tickers: {},
  scale: 1.0,
  enableKis: true,
  enableFallback: true,
  isVirtual: true,
};

// ─── 저수준 헬퍼 ───────────────────────────────────────────────────

const CONFIG_KEY = "mystockoverlay_config";
const AUTH_KEY = "kis_auth";

// ─── AppConfig 전체 읽기/쓰기 ──────────────────────────────────────

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next = { ...current, ...partial };
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
        appKey: c.virtualAppKey || c.appKey,
        appSecret: c.virtualAppSecret || c.appSecret,
      };
    }
    return {
      appKey: c.realAppKey || c.appKey,
      appSecret: c.realAppSecret || c.appSecret,
    };
  },
};

// ─── KIS 인증 토큰 ─────────────────────────────────────────────────

export const KisAuthStorage = {
  get(): KisAuth | null {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as KisAuth;
    } catch {
      return null;
    }
  },

  set(auth: KisAuth): void {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  },

  clear(): void {
    localStorage.removeItem(AUTH_KEY);
  },
};
