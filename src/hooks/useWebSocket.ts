import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StockData } from "../lib/types";
import { Config } from "../lib/storage";
import {
  getKisWsApprovalKey,
  getKisWsSubscriptionMessage,
  parseTickerData,
  isIndexSymbol
} from "../lib/kisApi";
import { getKisVirtualWsApprovalKey } from "../lib/kisVirtualApi";

const KIS_WS_URL_REAL = "ws://ops.koreainvestment.com:21000";
const KIS_WS_URL_VIRTUAL = "ws://ops.koreainvestment.com:31000";

/**
 * SRP: 웹소켓 연결 유지 및 실시간 틱 수신 시 차트 맨 뒤에 Append
 */
export function useWebSocket(
  activeSymbols: Set<string>,
  chartDataRefs: React.MutableRefObject<Map<string, any[]>>,
  lastUpdateTimesRef: React.MutableRefObject<Map<string, number>>
) {
  const wsRef = useRef<WebSocket | null>(null);
  const approvalKeyRef = useRef<string | null>(null);
  const subscribedRefs = useRef<Set<string>>(new Set());
  const isConnectingRef = useRef(false);

  // 내부 함수: 소켓 연결
  const connectWs = async () => {
    if (wsRef.current || isConnectingRef.current) return;
    isConnectingRef.current = true;

    try {
      const config = Config.get();
      const { appKey, appSecret } = Config.getActiveKeys();

      if (!config.kisEnabled || !appKey || !appSecret) {
        isConnectingRef.current = false;
        return;
      }

      if (!approvalKeyRef.current) {
        try {
          approvalKeyRef.current = config.isVirtual
            ? await getKisVirtualWsApprovalKey(appKey, appSecret)
            : await getKisWsApprovalKey(appKey, appSecret);
        } catch (e) {
            console.error(`[useWebSocket] WS Approval Key Fetch Failed:`, e);
            isConnectingRef.current = false;
            return;
        }
      }

      const wsUrl = config.isVirtual ? KIS_WS_URL_VIRTUAL : KIS_WS_URL_REAL;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        wsRef.current = socket;
        isConnectingRef.current = false;
        subscribedRefs.current.clear();
        console.log(`[useWebSocket] Connected to ${wsUrl}`);
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
                const trId = isIndexSymbol(parsedSymbol) ? "H0STCNI0" : "H0STCNT0";
                
                const parsed = parseTickerData(parsedSymbol, rawData, trId);
                // 실시간 수신 시간 기록
                lastUpdateTimesRef.current.set(parsedSymbol, Date.now());

                const unifiedData: StockData = {
                  ...parsed,
                  dataSource: 'KIS',
                  updatedAt: Date.now()
                };

                // ==== 차트 Append 로직 ====
                const sessionChart = chartDataRefs.current.get(parsedSymbol) || [];
                const now = new Date();
                const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                const hourStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                const newPoint = { price: Number(unifiedData.currentPrice), date: dateStr, hour: hourStr };

                let newChart = [...sessionChart];
                if (newChart.length > 0) {
                  const lastPoint = newChart[newChart.length - 1];
                  if (typeof lastPoint === 'object' && lastPoint.date && lastPoint.hour) {
                    const lastGroup = lastPoint.date + lastPoint.hour.substring(0, 3);
                    const currentGroup = newPoint.date + newPoint.hour.substring(0, 3);
                    if (lastGroup === currentGroup) {
                      newChart[newChart.length - 1] = newPoint; // 같은 10분 구간 갱신
                    } else {
                      newChart.push(newPoint); // 10분 구간 넘어가면 추가
                    }
                  } else {
                    newChart.push(newPoint); // 옛날 숫자 데이터 포맷 폴백
                  }
                } else {
                  newChart.push(newPoint); // 차트 비었을 때 최초 1개
                }

                if (newChart.length > 400) newChart = newChart.slice(-400); // 400개 유지
                
                chartDataRefs.current.set(parsedSymbol, newChart);
                unifiedData.intradayPrices = newChart;

                invoke("broadcast_ticker_data", { symbol: parsedSymbol, data: unifiedData }).catch(e => {
                  console.error(`[useWebSocket] Broadcast Ticker Failed for ${parsedSymbol}:`, e);
                });
              }
            } catch (e) {
              console.error("[useWebSocket] Parse error:", e);
            }
          } else {
            // Error handling JSONs (e.g., NOT FOUND, Expirations)
            try {
              const json = JSON.parse(rawData);
              if (json.body?.msg1) {
                const s = json.header?.tr_key;
                const trId = json.header?.tr_id;
                if (json.body.msg_cd !== "MCA00000" && json.body.rt_cd !== "0") {
                  if (s && (trId === "H0STCNT0" || trId === "H0STCNI0")) {
                    const isNotFound = typeof json.body.msg1 === 'string' && json.body.msg1.toUpperCase().includes("NOT FOUND");
                    if (!isNotFound) {
                      console.error(`[KIS WS Error] Sub failed for ${s} (${trId}):`, json);
                      invoke("broadcast_ticker_error", { symbol: s, message: `Subscribe Failed: ${json.body.msg1}` }).catch(console.error);
                    }
                  }
                }
              }
            } catch (e) { 
              console.error("[useWebSocket] WS JSON parse error:", e);
            }
          }
        }
      };

      socket.onerror = (err) => {
        console.error(`[useWebSocket] WS Connection Error:`, err);
        isConnectingRef.current = false;
      };

      socket.onclose = () => {
        console.log(`[useWebSocket] WS Connection Closed`);
        wsRef.current = null;
        isConnectingRef.current = false;
        subscribedRefs.current.clear();
      };

    } catch (err) {
      console.error("[useWebSocket] WS Connection Setup Failed:", err);
      isConnectingRef.current = false;
      approvalKeyRef.current = null;
    }
  };


  // 구독 관리 useEffect (주기적으로 체크)
  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval>;

    const syncSubscriptions = () => {
      const config = Config.get();
      const { appKey, appSecret } = Config.getActiveKeys();

      // [설정 변경 감지 및 동기화]
      const currentConfigSignature = `${config.isVirtual}-${appKey}-${appSecret}-${config.kisEnabled}`;
      const lastSignature = (syncSubscriptions as any).lastSignature;

      if (lastSignature && lastSignature !== currentConfigSignature) {
        console.log("[useWebSocket] Config changed, resetting WS connection & approval key.");
        approvalKeyRef.current = null;
        if (wsRef.current) wsRef.current.close();
      }
      (syncSubscriptions as any).lastSignature = currentConfigSignature;

      if (config.kisEnabled && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && approvalKeyRef.current) {
        
        // 추가된 심볼 구독
        for (const symbol of activeSymbols) {
          if (!subscribedRefs.current.has(symbol)) {
            const isIndex = isIndexSymbol(symbol);
            if (isIndex) {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0STCNI0"));
            } else {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0STCNT0"));
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0NXCNT0"));
            }
            subscribedRefs.current.add(symbol);
            // 웹소켓 연결 성공 직후 폴백 방지를 위해 시간 초기화 (InitialLoad가 데이터를 가져오기 전 빈틈 메우기)
            if(!lastUpdateTimesRef.current.has(symbol)) {
               lastUpdateTimesRef.current.set(symbol, Date.now()); 
            }
            console.log(`[useWebSocket] Subscribed to ${symbol}`);
          }
        }

        // 제거된 종목 구독 해제
        for (const symbol of Array.from(subscribedRefs.current)) {
          if (!activeSymbols.has(symbol)) {
            const isIndex = isIndexSymbol(symbol);
            if (isIndex) {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current!, symbol, false, "H0STCNI0"));
            } else {
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current!, symbol, false, "H0STCNT0"));
              wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current!, symbol, false, "H0NXCNT0"));
            }
            subscribedRefs.current.delete(symbol);
            lastUpdateTimesRef.current.delete(symbol);
            chartDataRefs.current.delete(symbol); // 캐시 메모리 정리
            console.log(`[useWebSocket] Unsubscribed from ${symbol}`);
          }
        }
      } else {
        if (config.kisEnabled && activeSymbols.size > 0 && !isConnectingRef.current && !wsRef.current) {
          connectWs();
        } else if ((!config.kisEnabled || activeSymbols.size === 0) && wsRef.current) {
          wsRef.current.close();
        }
      }
    };

    checkInterval = setInterval(syncSubscriptions, 1000);

    return () => {
      clearInterval(checkInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeSymbols]);

}
