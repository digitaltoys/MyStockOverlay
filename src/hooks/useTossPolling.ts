import { useEffect, useRef } from "react";
import { Config } from "../lib/storage";
import { createMarketDataProvider } from "../lib/providers";
import type { ChartPoint, StockData } from "../lib/types";
import { isIndexSymbol } from "../lib/market";
import { appendRealtimeChartPoint, broadcastTickerData, makeCurrentChartPoint } from "./realtimeUtils";

/**
 * 토스 Open API는 웹소켓 대신 REST 폴링으로 실시간성 갱신을 흉내냅니다.
 * 현재가를 주기적으로 조회하고, 마지막 차트 포인트를 덮어쓰거나 추가합니다.
 */
export function useTossPolling(
  activeSymbols: Set<string>,
  chartDataRefs: React.MutableRefObject<Map<string, ChartPoint[]>>,
  lastUpdateTimesRef: React.MutableRefObject<Map<string, number>>,
  enabled: boolean = true,
) {
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      const config = Config.get();
      if (config.dataSourceMode !== "toss") return;

      const provider = createMarketDataProvider(config);
      if (provider.mode !== "toss") return;

      for (const symbol of activeSymbols) {
        if (isIndexSymbol(symbol)) continue;
        if (inFlightRef.current.has(symbol)) continue;
        inFlightRef.current.add(symbol);

        void (async () => {
          try {
            const priceData = await provider.fetchPrice(symbol);
            const currentPrice = Number(priceData.currentPrice);
            if (!Number.isFinite(currentPrice)) return;

            const existingChart = chartDataRefs.current.get(symbol) || [];
            const nextPoint = makeCurrentChartPoint(currentPrice);
            const nextChart = appendRealtimeChartPoint(existingChart, nextPoint);

            chartDataRefs.current.set(symbol, nextChart);
            lastUpdateTimesRef.current.set(symbol, Date.now());

            const unifiedData: StockData = {
              ...priceData,
              dataSource: priceData.dataSource ?? "Toss",
              updatedAt: Date.now(),
              intradayPrices: nextChart,
            };

            broadcastTickerData(symbol, unifiedData).catch((err) => {
              console.error(`[useTossPolling] Broadcast Ticker Failed for ${symbol}:`, err);
            });
          } catch (error) {
            console.error(`[useTossPolling] Polling failed for ${symbol}:`, error);
          } finally {
            inFlightRef.current.delete(symbol);
          }
        })();
      }
      if (!cancelled) {
        const nextInterval = Math.max(3, Math.min(60, Math.round(Config.get().tossPollingIntervalSec || 10)));
        timeoutId = setTimeout(run, nextInterval * 1000);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeSymbols, chartDataRefs, lastUpdateTimesRef, enabled]);
}
