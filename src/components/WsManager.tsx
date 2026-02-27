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
  const chartTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const lastUpdateTimesRef = useRef<Map<string, number>>(new Map());
  const chartDataRefs = useRef<Map<string, any[]>>(new Map());

  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval>;

    const connectWs = async () => {
      if (wsRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;

      try {
        const config = Config.get();
        const { appKey, appSecret } = Config.getActiveKeys();
        if (!config.kisEnabled) {
          isConnectingRef.current = false;
          return;
        }
        if (!appKey || !appSecret) {
          isConnectingRef.current = false;
          return;
        }

        if (!approvalKeyRef.current) {
          approvalKeyRef.current = config.isVirtual
            ? await kisVirtualApi.getKisVirtualWsApprovalKey(appKey, appSecret)
            : await getKisWsApprovalKey(appKey, appSecret);
        }

        const wsUrl = config.isVirtual ? KIS_WS_URL_VIRTUAL : KIS_WS_URL_REAL;
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

                  // 실시간 차트 데이터 업데이트 (시간, 날짜 포함 객체로 구성)
                  const sessionChart = chartDataRefs.current.get(parsedSymbol) || [];
                  const now = new Date();
                  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                  const hourStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                  const newPoint = { price: Number(unifiedData.currentPrice), date: dateStr, hour: hourStr };

                  let newChart = [...sessionChart];
                  if (newChart.length > 0) {
                    const lastPoint = newChart[newChart.length - 1];
                    // 배열의 요소 타입 호환(초기 숫자형 vs 객체형) 검사
                    if (typeof lastPoint === 'object' && lastPoint.date && lastPoint.hour) {
                      const lastGroup = lastPoint.date + lastPoint.hour.substring(0, 3);
                      const currentGroup = newPoint.date + newPoint.hour.substring(0, 3);
                      if (lastGroup === currentGroup) {
                        // 같은 10분 구간이면 마지막 종가를 갱신
                        newChart[newChart.length - 1] = newPoint;
                      } else {
                        // 구간이 바뀌면 새로 추가
                        newChart.push(newPoint);
                      }
                    } else {
                      newChart.push(newPoint);
                    }
                  } else {
                    newChart.push(newPoint);
                  }

                  // 최대 400개 정도 유지 (당일 분봉 약 380개)
                  if (newChart.length > 400) newChart = newChart.slice(-400);
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
      const config = Config.get();
      const { appKey, appSecret } = Config.getActiveKeys();
      const activeSet = new Set(config.activeSymbols);

      // --- [설정 변경 감지 및 동기화] ---
      // 모드(isVirtual)나 API 키가 바뀌면 기존 타이머들을 모두 날려야 함 (클로저 stale 방지)
      const currentConfigSignature = `${config.isVirtual}-${appKey}-${appSecret}-${config.kisEnabled}`;
      const lastSignature = (syncSubscriptions as any).lastSignature;

      if (lastSignature && lastSignature !== currentConfigSignature) {
        console.log("[WsManager] Config changed (Mode/Keys/Enable), resetting all timers & approval key.");
        approvalKeyRef.current = null; // 승인키도 재발급 유도

        // 모든 타이머 강제 종료
        fallbackTimersRef.current.forEach(timer => clearInterval(timer));
        fallbackTimersRef.current.clear();
        chartTimersRef.current.forEach(timer => clearInterval(timer));
        chartTimersRef.current.clear();

        // 웹소켓도 재연결이 필요할 수 있으므로 닫기 (이후 루프에서 자동 재연결)
        if (wsRef.current) wsRef.current.close();
      }
      (syncSubscriptions as any).lastSignature = currentConfigSignature;
      // ------------------------------------

      // KIS WS 또는 REST 실패 시 폴백 작동을 위한 타이머 관리
      activeSet.forEach(symbol => {
        const lastUpdate = lastUpdateTimesRef.current.get(symbol) || 0;
        const timeSinceLastUpdate = Date.now() - lastUpdate;

        // --- [차트 30초 갱신 (오버라이트) 타이머 설정] ---
        if (config.kisEnabled && appKey && appSecret) {
          if (!chartTimersRef.current.has(symbol)) {
            const fetchFunc = config.isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
            const fetchChartFunc = config.isVirtual ? kisVirtualApi.fetchVirtualIntradayChart : fetchIntradayChart;
            const cTimer = setInterval(async () => {
              try {
                const priceData = await fetchFunc(appKey, appSecret, symbol);
                const chartData = await fetchChartFunc(appKey, appSecret, symbol);

                chartDataRefs.current.set(symbol, chartData);
                lastUpdateTimesRef.current.set(symbol, Date.now());
                const unifiedData: StockData = {
                  ...priceData,
                  dataSource: 'KIS',
                  updatedAt: Date.now(),
                  intradayPrices: chartData
                };
                invoke("broadcast_ticker_data", { symbol, data: unifiedData }).catch(console.error);
              } catch (e) {
                console.error(`Chart 30s Polling Error for ${symbol}`, e);
              }
            }, 30000); // 30초 간격 반복
            chartTimersRef.current.set(symbol, cTimer);
          }
        } else {
          // KIS 비활성화 시 차트 폴링 해제
          if (chartTimersRef.current.has(symbol)) {
            clearInterval(chartTimersRef.current.get(symbol)!);
            chartTimersRef.current.delete(symbol);
          }
        }
        // ---------------------------------------------------

        // KIS 데이터가 30초 이상 없거나 KIS가 꺼져 있으면 폴백 모드 검토
        const shouldTryFallback = config.apis.yahoo.enabled && (timeSinceLastUpdate > 30 * 1000 || !config.kisEnabled);

        if (shouldTryFallback) {
          if (!fallbackTimersRef.current.has(symbol)) {
            console.log(`Starting Fallback for ${symbol} (Criteria met)`);

            // KIS REST 폴링 타이머 (10초마다 갱신 - Yahoo보다 빠름)
            if (config.kisEnabled && appKey && appSecret) {
              const fetchFunc = config.isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
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
                    if (config.kisEnabled) {
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

      // 제거된 종목의 폴백/차트 타이머 정리
      Array.from(fallbackTimersRef.current.entries()).forEach(([sym, timer]: [string, any]) => {
        if (!activeSet.has(sym)) {
          clearInterval(timer);
          fallbackTimersRef.current.delete(sym);
        }
      });
      Array.from(chartTimersRef.current.entries()).forEach(([sym, timer]: [string, any]) => {
        if (!activeSet.has(sym)) {
          clearInterval(timer);
          chartTimersRef.current.delete(sym);
        }
      });

      if (config.kisEnabled && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && approvalKeyRef.current) {
        const symbolsToInit: string[] = [];

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
            lastUpdateTimesRef.current.set(symbol, Date.now()); // 추가 즉시 폴백 방지를 위해 현재 시간으로 초기화
            symbolsToInit.push(symbol);
          }
        }

        // REST로 현재가 및 차트 초기값 순차 로드 (TPS 제한 방어)
        if (symbolsToInit.length > 0) {
          (async () => {
            const currentConfig = Config.get();
            const { appKey, appSecret } = Config.getActiveKeys();
            const isV = currentConfig.isVirtual;
            if (!appKey || !appSecret) return;

            const fetchFunc = isV ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
            const fetchChartFunc = isV ? kisVirtualApi.fetchVirtualIntradayChart : fetchIntradayChart;

            for (const symbol of symbolsToInit) {
              try {
                // 1. 현재가 조회 (동기)
                const data = await fetchFunc(appKey, appSecret, symbol);
                lastUpdateTimesRef.current.set(symbol, Date.now());
                invoke("broadcast_ticker_data", {
                  symbol,
                  data: { ...data, dataSource: 'KIS', updatedAt: Date.now(), intradayPrices: chartDataRefs.current.get(symbol) }
                }).catch(console.error);

                // TPS 방어 대기
                await new Promise(r => setTimeout(r, 600));

                // 2. 차트 조회 (동기)
                const chartData = await fetchChartFunc(appKey, appSecret, symbol);
                console.log(`[WsManager] Initial Chart Load for ${symbol}: KIS points = ${chartData.length}`);

                let finalChart = chartData;

                if (finalChart.length === 0 && config.apis.yahoo.enabled && !config.kisEnabled) {
                  // KIS가 꺼져있을 때만 Yahoo에서 차트 보완 시도 (중복 방지)
                  try {
                    const fbData = await fetchFallbackData(symbol);
                    if (fbData.intradayPrices && fbData.intradayPrices.length > 0) {
                      finalChart = fbData.intradayPrices as any;
                    }
                  } catch (e) {
                    console.error(`[WsManager] Fallback Failed for ${symbol}`, e);
                  }
                }

                if (finalChart.length > 0) {
                  chartDataRefs.current.set(symbol, finalChart);
                }

                // TPS 방어 대기 (다음 심볼 진행 전)
                await new Promise(r => setTimeout(r, 600));

              } catch (e) {
                console.error(`[WsManager] Init fetch error for ${symbol}`, e);
              }
            }
          })();
        }

        // 제거된 종목 구독 해제 (KRX + NXT 모두)
        for (const symbol of Array.from(subscribedRefs.current)) {
          if (!activeSet.has(symbol)) {
            const isIndex = isIndexSymbol(symbol);
            if (wsRef.current && approvalKeyRef.current) {
              if (isIndex) {
                wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0STCNI0"));
              } else {
                wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0STCNT0"));
                wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0NXCNT0"));
              }
            }
            subscribedRefs.current.delete(symbol);
            lastUpdateTimesRef.current.delete(symbol);
          }
        }
      } else {
        if (config.kisEnabled && activeSet.size > 0 && !isConnectingRef.current && !wsRef.current) {
          connectWs();
        } else if ((!config.kisEnabled || activeSet.size === 0) && wsRef.current) {
          wsRef.current.close();
        }
      }
    };

    checkInterval = setInterval(syncSubscriptions, 1000);

    return () => {
      clearInterval(checkInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return null;
}
