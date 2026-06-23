import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Config } from "../lib/storage";
import { kisDataManager } from "../lib/managers/KisDataManager";
import { fetchFallbackData } from "../lib/fallbackApi";

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
    const sig = `${config.isVirtual}-${appKey}-${appSecret}-${config.kisEnabled}`;
    
    if ((useInitialLoad as any).lastSig !== sig) {
      initializedSymbolsRef.current.clear();
      (useInitialLoad as any).lastSig = sig;
    }
  }, []); // 실제로는 WsManager에서 리렌더링 될 때마다 체크하지만, 편의상 빈 디펜던시

  useEffect(() => {
    const config = Config.get();
    const { appKey, appSecret } = Config.getActiveKeys();

    if (!config.kisEnabled) {
      console.log(`[useInitialLoad] KIS is disabled. Skipping initial load.`);
      return;
    }
    if (!appKey || !appSecret) {
      console.error(`[useInitialLoad] API Keys are missing. Cannot load data.`);
      return;
    }

    for (const symbol of activeSymbols) {
      if (!initializedSymbolsRef.current.has(symbol)) {
        // 최초 1회 로딩 비동기 함수 즉시 실행
        (async () => {
          console.log(`[useInitialLoad] Starting initial data load for: ${symbol}`);
          try {
            // 1. KisDataManager를 통해 현재가 1번 호출 (동일 시점 타 컴포넌트 호출 방지)
            console.log(`[useInitialLoad] Fetching price for ${symbol}...`);
            const priceData = await kisDataManager.fetchPrice(appKey, appSecret, symbol, config.isVirtual);
            console.log(`[useInitialLoad] Price fetch success for ${symbol}: ${priceData.currentPrice}`);
            
            // 로드 성공 직후 프론트에 전송 (가벼움)
            lastUpdateTimesRef.current.set(symbol, Date.now());
            invoke("broadcast_ticker_data", {
              symbol,
              data: {
                ...priceData,
                dataSource: 'KIS',
                updatedAt: Date.now(),
                intradayPrices: chartDataRefs.current.get(symbol) || []
              }
            }).catch(e => console.error(`[useInitialLoad] broadcast price failed for ${symbol}:`, e));

            // 2. KisDataManager를 통해 전체 차트 1번 호출
            console.log(`[useInitialLoad] Fetching intraday chart for ${symbol}...`);
            let chartData = await kisDataManager.fetchChart(appKey, appSecret, symbol, config.isVirtual);
            console.log(`[useInitialLoad] Chart fetch success for ${symbol}, points: ${chartData?.length ?? 0}`);
            
            // KIS 차트가 비어있고 Yahoo 폴백이 켜져있다면 (주로 장기 휴장 시)
            if (chartData.length === 0 && config.apis.yahoo.enabled) {
                try {
                    const fbData = await fetchFallbackData(symbol);
                    if (fbData.intradayPrices && fbData.intradayPrices.length > 0) {
                        chartData = fbData.intradayPrices as any;
                    }
                } catch (e) {
                    console.error(`[useInitialLoad] Fallback Chart fetch failed for ${symbol}:`, e);
                }
            }

            if (chartData.length > 0) {
                chartDataRefs.current.set(symbol, chartData);
                // 차트가 업데이트 됐으니 한 번 더 브로드캐스트
                invoke("broadcast_ticker_data", {
                    symbol,
                    data: {
                        ...priceData,
                        dataSource: 'KIS',
                        updatedAt: Date.now(),
                        intradayPrices: chartData
                    }
                }).catch(e => console.error(`[useInitialLoad] broadcast chart failed for ${symbol}:`, e));
                console.log(`[useInitialLoad] Initial Chart Load Success for ${symbol}. Points: ${chartData.length}`);
            }

            // 모든 호출이 성사되면 셋에 기록
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
