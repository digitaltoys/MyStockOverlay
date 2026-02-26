import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getKisWsApprovalKey,
  getKisWsSubscriptionMessage,
  parseTickerData,
  fetchCurrentPriceUnified,
  fetchIntradayChart,
  isIndexSymbol
} from "../lib/kisApi";
import * as kisVirtualApi from "../lib/kisVirtualApi";
import { fetchFallbackData } from "../lib/fallbackApi";
import { StockData, FETCH_INTERVALS } from "../lib/types";
import { Config } from "../lib/storage";

const KIS_WS_URL_REAL = "ws://ops.koreainvestment.com:21000";
const KIS_WS_URL_VIRTUAL = "ws://ops.koreainvestment.com:31000";

export default function WsManager() {
  const wsRef = useRef<WebSocket | null>(null);
  const approvalKeyRef = useRef<string | null>(null);
  const subscribedRefs = useRef<Set<string>>(new Set());
  const isConnectingRef = useRef(false);
  const fallbackTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const lastUpdateTimesRef = useRef<Map<string, number>>(new Map());
  const chartDataRefs = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval>;

    const connectWs = async () => {
      if (wsRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;

      try {
        const { enableKis } = Config.get();
        const { appKey, appSecret } = Config.getActiveKeys(); // 실/모의 모드별 활성 key
        if (!enableKis) {
          isConnectingRef.current = false;
          return;
        }
        if (!appKey || !appSecret) {
          isConnectingRef.current = false;
          return;
        }

        if (!approvalKeyRef.current) {
          const { isVirtual } = Config.get();
          approvalKeyRef.current = isVirtual
            ? await kisVirtualApi.getKisVirtualWsApprovalKey(appKey, appSecret)
            : await getKisWsApprovalKey(appKey, appSecret);
        }

        const { isVirtual } = Config.get();
        const wsUrl = isVirtual ? KIS_WS_URL_VIRTUAL : KIS_WS_URL_REAL;
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          wsRef.current = socket;
          isConnectingRef.current = false;
          subscribedRefs.current.clear();
        };

        socket.onmessage = (event) => {
          const rawData = event.data;
          if (typeof rawData === "string") {
            if (rawData.includes("PINGPONG")) {
              socket.send(rawData);
              return;
            }
            if (rawData.startsWith("0") || rawData.startsWith("1")) {
              try {
                const parts = rawData.split('|');
                if (parts.length >= 4) {
                  const details = parts[3].split('^');
                  const parsedSymbol = details[0];
                  // trId 확인용 플래그: KIS 웹소켓 지수 데이터는 tr_id가 앞에 명시적으로 오지 않으므로
                  // 현재 구독된 내역 중 isIndexSymbol 판단을 통해 trId를 유추하거나, 
                  // 종목 코드 자체(parsedSymbol)가 지수인지 판별하여 넘깁니다.
                  const trId = isIndexSymbol(parsedSymbol) ? "H0STCNI0" : "H0STCNT0";
                  const parsed = parseTickerData(parsedSymbol, rawData, trId);
                  // console.log("Parsed ticker:", parsedSymbol, parsed);
                  lastUpdateTimesRef.current.set(parsedSymbol, Date.now());

                  const unifiedData: StockData = {
                    ...parsed,
                    dataSource: 'KIS',
                    updatedAt: Date.now()
                  };

                  // 실시간 차트 데이터 업데이트
                  const sessionChart = chartDataRefs.current.get(parsedSymbol) || [];
                  const newChart = [...sessionChart, unifiedData.currentPrice as number];
                  // 최대 400개 정도 유지 (당일 분봉 약 380개)
                  if (newChart.length > 400) newChart.shift();
                  chartDataRefs.current.set(parsedSymbol, newChart);
                  unifiedData.intradayPrices = newChart;

                  invoke("broadcast_ticker_data", { symbol: parsedSymbol, data: unifiedData }).catch(console.error);
                }
              } catch (e) {
                console.error("Parse error:", e);
              }
            } else {
              try {
                const json = JSON.parse(rawData);
                if (json.body?.msg1) {
                  const s = json.header?.tr_key;
                  const trId = json.header?.tr_id;
                  if (json.body.msg_cd !== "MCA00000" && json.body.rt_cd !== "0") {
                    // NXT 구독 실패는 무시 (종목이 NXT 미상장일 수 있음)
                    if (s && (trId === "H0STCNT0" || trId === "H0STCNI0")) {
                      invoke("broadcast_ticker_error", { symbol: s, message: `거부됨: ${json.body.msg1}` }).catch(console.error);
                    }
                  }
                }
              } catch (e) { }
            }
          }
        };

        socket.onerror = () => {
          isConnectingRef.current = false;
        };

        socket.onclose = () => {
          wsRef.current = null;
          isConnectingRef.current = false;
          subscribedRefs.current.clear();
        };

      } catch (err) {
        console.error("WS connection failed:", err);
        isConnectingRef.current = false;
        approvalKeyRef.current = null;
      }
    };

    const syncSubscriptions = () => {
      const { activeSymbols, enableKis, enableFallback, isVirtual } = Config.get();
      const { appKey, appSecret } = Config.getActiveKeys(); // 실/모의 모드에 따른 활성 key
      const activeSet = new Set(activeSymbols);

      // KIS WS 또는 REST 실패 시 폴백 작동을 위한 타이머 관리
      activeSet.forEach(symbol => {
        const lastUpdate = lastUpdateTimesRef.current.get(symbol) || 0;
        const timeSinceLastUpdate = Date.now() - lastUpdate;

        // KIS 데이터가 10초 이상 없거나 KIS가 꺼져 있으면 폴백 모드 검토
        const shouldTryFallback = enableFallback && (timeSinceLastUpdate > 10 * 1000 || !enableKis);

        if (shouldTryFallback) {
          if (!fallbackTimersRef.current.has(symbol)) {
            console.log(`Starting Fallback for ${symbol} (Criteria met)`);

            // KIS REST 폴링 타이머 (10초마다 갱신 - Yahoo보다 빠름)
            if (enableKis && appKey && appSecret) {
              const fetchFunc = isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
              // 즉시 1회 실행
              fetchFunc(appKey, appSecret, symbol)
                .then(data => {
                  lastUpdateTimesRef.current.set(symbol, Date.now());
                  const unifiedData: StockData = {
                    ...data,
                    dataSource: 'KIS',
                    updatedAt: Date.now(),
                    intradayPrices: chartDataRefs.current.get(symbol)
                  };
                  invoke("broadcast_ticker_data", { symbol, data: unifiedData }).catch(console.error);
                })
                .catch(e => console.error(`REST Fallback price error for ${symbol}`, e));

              const timer = setInterval(() => {
                // WS가 살아나서 최근 5초 이내 데이터가 왔으면 REST 폴링 스킵
                const cur = lastUpdateTimesRef.current.get(symbol) || 0;
                if (Date.now() - cur < 5000) return;

                fetchFunc(appKey, appSecret, symbol)
                  .then(data => {
                    lastUpdateTimesRef.current.set(symbol, Date.now());
                    const unifiedData: StockData = {
                      ...data,
                      dataSource: 'KIS',
                      updatedAt: Date.now(),
                      intradayPrices: chartDataRefs.current.get(symbol)
                    };
                    invoke("broadcast_ticker_data", { symbol, data: unifiedData }).catch(console.error);
                  })
                  .catch(e => console.error(`REST Polling error for ${symbol}`, e));
              }, FETCH_INTERVALS.KIS_REST * 5); // 10초마다 (2000*5)

              fallbackTimersRef.current.set(symbol, timer);
            } else {
              // KIS 비활성화 시 Yahoo 폴백
              fetchFallbackData(symbol)
                .then(data => invoke("broadcast_ticker_data", { symbol, data }).catch(console.error))
                .catch(e => console.error(`Initial Fallback Error for ${symbol}`, e));

              const timer = setInterval(() => {
                fetchFallbackData(symbol)
                  .then(data => {
                    if (enableKis) {
                      const currentLast = lastUpdateTimesRef.current.get(symbol) || 0;
                      if (Date.now() - currentLast < 30 * 1000) return;
                    }
                    invoke("broadcast_ticker_data", { symbol, data }).catch(console.error);
                  })
                  .catch(console.error);
              }, FETCH_INTERVALS.FALLBACK_POLLING);
              fallbackTimersRef.current.set(symbol, timer);
            }
          }
        } else {
          // 폴백을 사용 중지했거나 KIS 데이터가 잘 들어오고 있으면 타이머 제거
          if (fallbackTimersRef.current.has(symbol)) {
            console.log(`Stopping Fallback for ${symbol}`);
            clearInterval(fallbackTimersRef.current.get(symbol)!);
            fallbackTimersRef.current.delete(symbol);
          }
        }
      });

      // 제거된 종목의 폴백 타이머 정리
      Array.from(fallbackTimersRef.current.entries()).forEach(([symbol, timer]: [string, any]) => {
        if (!activeSet.has(symbol)) {
          clearInterval(timer);
          fallbackTimersRef.current.delete(symbol);
        }
      });

      if (enableKis && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && approvalKeyRef.current) {
        let requestDelay = 0;
        for (const symbol of activeSet) {
          if (!subscribedRefs.current.has(symbol)) {
            const isIndex = isIndexSymbol(symbol);
            if (isIndex) {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0STCNI0"));
            } else {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0STCNT0"));
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0NXCNT0"));
            }
            subscribedRefs.current.add(symbol);

            // REST로 현재가 및 차트 초기값 로드
            const { appKey, appSecret, isVirtual } = Config.get();
            if (appKey && appSecret) {
              const fetchFunc = isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
              const fetchChartFunc = isVirtual ? kisVirtualApi.fetchVirtualIntradayChart : fetchIntradayChart;

              // 현재가 조회 지연 예약
              const priceDelay = requestDelay;
              requestDelay += 1000;
              setTimeout(async () => {
                try {
                  const data = await fetchFunc(appKey, appSecret, symbol);
                  lastUpdateTimesRef.current.set(symbol, Date.now());
                  invoke("broadcast_ticker_data", {
                    symbol,
                    data: { ...data, dataSource: 'KIS', updatedAt: Date.now(), intradayPrices: chartDataRefs.current.get(symbol) }
                  }).catch(console.error);
                } catch (e) {
                  console.error(`[WsManager] Price fetch error for ${symbol}`, e);
                }
              }, priceDelay);

              // 차트 조회 지연 예약 (현재가 호출과 1000ms 간격)
              const chartDelay = requestDelay;
              requestDelay += 1000;
              setTimeout(async () => {
                try {
                  const chartData = await fetchChartFunc(appKey, appSecret, symbol);
                  console.log(`[WsManager] Initial Chart Load for ${symbol}: KIS points = ${chartData.length}`);

                  let finalChart = chartData;

                  // KIS 차트 데이터가 없으면 폴백 시도
                  if (finalChart.length === 0) {
                    console.log(`[WsManager] KIS Chart empty for ${symbol}, trying Yahoo Fallback...`);
                    try {
                      const fbData = await fetchFallbackData(symbol);
                      if (fbData.intradayPrices && fbData.intradayPrices.length > 0) {
                        finalChart = fbData.intradayPrices;
                        console.log(`[WsManager] Fallback Chart SUCCESS for ${symbol}: points = ${finalChart.length}`);
                      }
                    } catch (e) {
                      console.error(`[WsManager] Fallback Failed for ${symbol}`, e);
                    }
                  }

                  if (finalChart.length > 0) {
                    chartDataRefs.current.set(symbol, finalChart);
                    console.log(`[WsManager] Chart saved for ${symbol}: ${finalChart.length} points. Next price poll will include it.`);
                    // 브로드캐스트하지 않음: changeRate 없이 전송하면 가격 정보가 0으로 덮어씌워짐
                    // 다음 REST 폴링(10초마다)에서 intradayPrices를 포함하여 전송됨
                  }
                } catch (e) {
                  console.error(`[WsManager] Chart fetch error for ${symbol}`, e);
                }
              }, chartDelay);
            }
          }
        }
        // 제거된 종목 구독 해제 (KRX + NXT 모두)
        for (const symbol of subscribedRefs.current) {
          if (!activeSet.has(symbol)) {
            const isIndex = isIndexSymbol(symbol);
            if (isIndex) {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0STCNI0"));
            } else {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0STCNT0"));
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0NXCNT0"));
            }
            subscribedRefs.current.delete(symbol);
            lastUpdateTimesRef.current.delete(symbol);
          }
        }
      } else {
        if (enableKis && activeSet.size > 0 && !isConnectingRef.current && !wsRef.current) {
          connectWs();
        } else if ((!enableKis || activeSet.size === 0) && wsRef.current) {
          wsRef.current.close();
        }
      }
    };

    checkInterval = setInterval(syncSubscriptions, 1000);

    return () => {
      clearInterval(checkInterval);
      fallbackTimersRef.current.forEach(clearInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return null;
}
