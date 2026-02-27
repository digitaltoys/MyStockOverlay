import { fetch } from '@tauri-apps/plugin-http';
import { StockData } from './types';
import { ChartCacheManager } from './chartCache';

/**
 * Yahoo Finance를 통한 폴백 데이터 수신
 * 국내 종목의 경우 종목코드 뒤에 .KS (KOSPI) 또는 .KQ (KOSDAQ)가 필요할 수 있음
 */
export async function fetchFallbackData(symbol: string): Promise<StockData> {
  // 간단한 지수용 심볼 변환 (Yahoo Finance 기준)
  let yahooSymbol = symbol;
  if (symbol === "0001") yahooSymbol = "^KS11"; // KOSPI
  else if (symbol === "1001") yahooSymbol = "^KQ11"; // KOSDAQ
  else if (symbol.length === 6) {
    // 한국 종목은 .KS(코스피) 또는 .KQ(코스닥)가 필요함
    // 일단 .KS로 시도하되, 추후 필요시 시장 정보를 받아오거나 둘 다 시도하는 로직으로 확장 가능
    yahooSymbol = `${symbol}.KS`;
  }

  try {
    // Yahoo Finance Query API 사용 (CORS 이슈는 Tauri fetch가 해결)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      throw new Error(`Fallback fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) {
      throw new Error("Invalid Yahoo Finance response: result is empty");
    }
    const meta = result.meta;
    
    // Yahoo는 regularMarketPrice 또는 chartPreviousClose 등을 제공함
    const currentPrice = meta.regularMarketPrice ?? meta.chartPreviousClose;
    
    if (currentPrice === undefined || currentPrice === null) {
      throw new Error(`Price data not found for ${symbol}`);
    }

    const priceNum = Number(currentPrice);
    const prevCloseNum = Number(meta.chartPreviousClose) || priceNum;
    const changeRate = prevCloseNum ? ((priceNum - prevCloseNum) / prevCloseNum) * 100 : 0;

    // 차트 데이터 추출 (분봉)
    const indicators = result.indicators?.quote?.[0];
    const intradayPrices = (indicators?.close || [])
      .filter((p: any) => p !== null && p !== undefined) as number[];

    const resultData: StockData = {
      symbol,
      currentPrice: priceNum,
      changeRate: changeRate.toFixed(2),
      isUp: priceNum > prevCloseNum,
      isDown: priceNum < prevCloseNum,
      basePrice: prevCloseNum,
      dataSource: 'Fallback',
      updatedAt: Date.now(),
      intradayPrices: intradayPrices.length > 0 ? intradayPrices : undefined
    };
    
    // 기준가 캐시 업데이트
    ChartCacheManager.updateBasePrice(symbol, prevCloseNum);

    return resultData;
    
  } catch (error) {
    console.error(`Fallback error for ${symbol}:`, error);
    throw error;
  }
}
