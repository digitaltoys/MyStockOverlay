import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Config } from "../lib/storage";
import { createMarketDataProvider } from "../lib/providers";
import { isIndexSymbol } from "../lib/market";

/**
 * SRP: 앱 실행 또는 종목 추가 시 최초 1회만 데이터 로딩 (가격, 차트)
 */
export function useInitialLoad(
  activeSymbols: Set<string>,
  chartDataRefs: React.MutableRefObject<Map<string, any[]>>,
  lastUpdateTimesRef: React.MutableRefObject<Map<string, number>>
) {
  // 이미 초기 로드된 종목 추적 (중복 로드 방지)
  const initializedSymbolsRef = useRef<Set<string>>(new Set());

  // 설정값 변경(API 키, 모드 변경) 시 초기화 세트 초기화
  useEffect(() => {
    const config = Config.get();
    const { appKey, appSecret } = Config.getActiveKeys();
    const sig = `${config.dataSourceMode}-${appKey}-${appSecret}`;
    
    if ((useInitialLoad as any).lastSig !== sig) {
      initializedSymbolsRef.current.clear();
      (useInitialLoad as any).lastSig = sig;
    }
  }, []); // 실제로는 WsManager에서 리렌더링 될 때마다 체크하지만, 편의상 빈 디펜던시

  useEffect(() => {
    const config = Config.get();
    const provider = createMarketDataProvider(config);

    for (const symbol of activeSymbols) {
      if (!initializedSymbolsRef.current.has(symbol)) {
        if (provider.mode === "toss" && isIndexSymbol(symbol)) {
          initializedSymbolsRef.current.add(symbol);
          continue;
        }

        // 최초 1회 로딩 비동기 함수 즉시 실행
        (async () => {
          console.log(`[useInitialLoad] Starting initial data load for: ${symbol}`);
          try {
            const isToss = provider.mode === "toss";
            let priceData;
            let chartData = chartDataRefs.current.get(symbol) || [];

            if (isToss) {
              console.log(`[useInitialLoad] Fetching intraday chart for ${symbol}...`);
              chartData = await provider.fetchChart(symbol);
              console.log(`[useInitialLoad] Chart fetch success for ${symbol}, points: ${chartData?.length ?? 0}`);

              if (chartData.length > 0) {
                chartDataRefs.current.set(symbol, chartData);
              }

              console.log(`[useInitialLoad] Fetching price for ${symbol}...`);
              priceData = await provider.fetchPrice(symbol);
              console.log(`[useInitialLoad] Price fetch success for ${symbol}: ${priceData.currentPrice}`);
            } else {
              console.log(`[useInitialLoad] Fetching price for ${symbol}...`);
              priceData = await provider.fetchPrice(symbol);
              console.log(`[useInitialLoad] Price fetch success for ${symbol}: ${priceData.currentPrice}`);

              console.log(`[useInitialLoad] Fetching intraday chart for ${symbol}...`);
              chartData = await provider.fetchChart(symbol);
              console.log(`[useInitialLoad] Chart fetch success for ${symbol}, points: ${chartData?.length ?? 0}`);

              if (chartData.length > 0) {
                chartDataRefs.current.set(symbol, chartData);
              }
            }

            // 로드 성공 직후 프론트에 전송 (가벼움)
            lastUpdateTimesRef.current.set(symbol, Date.now());
            invoke("broadcast_ticker_data", {
              symbol,
              data: {
                ...priceData,
                dataSource: priceData.dataSource ?? provider.name,
                updatedAt: Date.now(),
                intradayPrices: chartData
              }
            }).catch(e => console.error(`[useInitialLoad] broadcast price failed for ${symbol}:`, e));
            if (chartData.length > 0) {
              console.log(`[useInitialLoad] Initial Chart Load Success for ${symbol}. Points: ${chartData.length}`);
            }

            initializedSymbolsRef.current.add(symbol);

          } catch (e) {
            console.error(`[useInitialLoad] Action Failed for ${symbol}:`, e);
          }
        })();
      }
    }

    // 목록에서 삭제된 종목은 캐시에서 날려줌
    for (const cachedSymbol of Array.from(initializedSymbolsRef.current)) {
      if (!activeSymbols.has(cachedSymbol)) {
        initializedSymbolsRef.current.delete(cachedSymbol);
      }
    }
  }, [activeSymbols]); // Set의 참조 변경 시 재실행
}
