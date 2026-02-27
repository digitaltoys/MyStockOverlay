export interface ChartPoint {
  price: number;
  date: string;
  hour: string;
}

export interface StockData {
  symbol: string;
  currentPrice: number | string;
  changeRate: number | string;
  isUp: boolean;
  isDown: boolean;
  basePrice?: number; // 전일 종가
  dataSource: 'KIS' | 'Fallback';
  updatedAt: number;
  intradayPrices?: number[] | ChartPoint[]; // 당일 주가 흐름 (Sparkline용)
}

export const FETCH_INTERVALS = {
  KIS_REST: 2000,           // KIS REST 초기화/갱신 (웹소켓 미작동 시)
  FALLBACK_POLLING: 60000,  // 폴백 API (Yahoo Finance) 폴링 주기 - 60초
};
