import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StockData, FETCH_INTERVALS } from "../lib/types";
import { Config } from "../lib/storage";
import { kisDataManager } from "../lib/managers/KisDataManager";
import { fetchFallbackData } from "../lib/fallbackApi";

/**
 * SRP: 웹소켓 오류나 타임아웃 발생 시 REST API로 폴백 로딩
 */
export function useFallback(
  activeSymbols: Set<string>,
  chartDataRefs: React.MutableRefObject<Map<string, any[]>>,
  lastUpdateTimesRef: React.MutableRefObject<Map<string, number>>
) {
  const fallbackTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // 타이머 정리 로직: 종목 목록에서 제거된 심볼의 타이머 삭제
  useEffect(() => {
    Array.from(fallbackTimersRef.current.entries()).forEach(([sym, timer]: [string, any]) => {
      if (!activeSymbols.has(sym)) {
        clearInterval(timer);
        fallbackTimersRef.current.delete(sym);
        console.log(`[useFallback] Stopped polling for ${sym} (Removed)`);
      }
    });

    const config = Config.get();
    const { appKey, appSecret } = Config.getActiveKeys();

    activeSymbols.forEach(symbol => {
      const lastUpdate = lastUpdateTimesRef.current.get(symbol) || 0;
      const timeSinceLastUpdate = Date.now() - lastUpdate;
      
      // 웹소켓으로 가장 최근 데이터가 들어온 지 30초가 넘었거나, KIS가 아예 꺼져있다면 폴백 가동
      const shouldTryFallback = config.apis.yahoo.enabled && (timeSinceLastUpdate > 30 * 1000 || !config.kisEnabled);

      if (shouldTryFallback) {
        if (!fallbackTimersRef.current.has(symbol)) {
          console.log(`[useFallback] Starting Fallback for ${symbol} (Criteria met)`);

          if (config.kisEnabled && appKey && appSecret) {
            // [KIS REST 폴링 모드] - 10초마다 갱신
            // => 즉시 1회 실행 후 타이머 등록
            kisDataManager.fetchPrice(appKey, appSecret, symbol, config.isVirtual)
              .then(data => {
                lastUpdateTimesRef.current.set(symbol, Date.now());
                const unifiedData: StockData = {
                  ...data,
                  dataSource: 'KIS',
                  updatedAt: Date.now(),
                  intradayPrices: chartDataRefs.current.get(symbol) || [] // 기존에 모인 차트 이어서 사용
                };
                invoke("broadcast_ticker_data", { symbol, data: unifiedData }).catch(e => console.error(e));
              })
              .catch(e => console.error(`[useFallback] REST Fallback init error for ${symbol}`, e));

            const timer = setInterval(() => {
              // WS가 살아나서 최근 5초 이내 실시간 데이터가 들어왔다면 REST 폴링 스킵
              const cur = lastUpdateTimesRef.current.get(symbol) || 0;
              if (Date.now() - cur < 5000) return;

              kisDataManager.fetchPrice(appKey, appSecret, symbol, config.isVirtual)
                .then(data => {
                  lastUpdateTimesRef.current.set(symbol, Date.now());
                  const unifiedData: StockData = {
                    ...data,
                    dataSource: 'KIS',
                    updatedAt: Date.now(),
                    intradayPrices: chartDataRefs.current.get(symbol) || []
                  };
                  invoke("broadcast_ticker_data", { symbol, data: unifiedData }).catch(e => console.error(e));
                })
                .catch(e => console.error(`[useFallback] REST Polling error for ${symbol}`, e));
            }, FETCH_INTERVALS.KIS_REST * 5); // 10초
            fallbackTimersRef.current.set(symbol, timer);

          } else {
            // [Yahoo 파이낸스 폴백 모드] - KIS가 아예 꺼져있을 때
            fetchFallbackData(symbol)
              .then(data => {
                  // 야후 폴백이 차트가 없다면, 기존 KIS 차트를 덧붙여줌
                  if(!data.intradayPrices || data.intradayPrices.length === 0) {
                      data.intradayPrices = chartDataRefs.current.get(symbol) || [];
                  }
                  invoke("broadcast_ticker_data", { symbol, data }).catch(console.error);
              })
              .catch(e => console.error(`[useFallback] Initial Yahoo Fallback Error for ${symbol}`, e));

            const timer = setInterval(() => {
              fetchFallbackData(symbol)
                .then(data => {
                  if (config.kisEnabled) {
                    const currentLast = lastUpdateTimesRef.current.get(symbol) || 0;
                    if (Date.now() - currentLast < 30 * 1000) return; // 다시 앱 복구됐으면 야후 무시
                  }
                  if(!data.intradayPrices || data.intradayPrices.length === 0) {
                      data.intradayPrices = chartDataRefs.current.get(symbol) || [];
                  }
                  invoke("broadcast_ticker_data", { symbol, data }).catch(console.error);
                })
                .catch(e => console.error(`[useFallback] Yahoo Polling error for ${symbol}`, e));
            }, FETCH_INTERVALS.FALLBACK_POLLING);
            fallbackTimersRef.current.set(symbol, timer);
          }
        }
      } else {
        // 폴백 타이머 기준에 미달(정상 수신 중)하면 타이머 해제
        if (fallbackTimersRef.current.has(symbol)) {
          console.log(`[useFallback] Stopping Fallback for ${symbol} (WS recovered)`);
          clearInterval(fallbackTimersRef.current.get(symbol)!);
          fallbackTimersRef.current.delete(symbol);
        }
      }
    });
  }); // 의존성 배열 없이 매 렌더링(WsManager의 1초 주기 타이머)마다 폴백 상태를 점검

}
