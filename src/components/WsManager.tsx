import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getKisWsApprovalKey,
  getKisWsSubscriptionMessage,
  parseTickerData,
  fetchCurrentPrice,
  isIndexSymbol
} from "../lib/kisApi";
import { Config } from "../lib/storage";

const KIS_WS_URL = "ws://ops.koreainvestment.com:21000";

export default function WsManager() {
  const wsRef = useRef<WebSocket | null>(null);
  const approvalKeyRef = useRef<string | null>(null);
  const subscribedRefs = useRef<Set<string>>(new Set());
  const isConnectingRef = useRef(false);

  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval>;

    const connectWs = async () => {
      if (wsRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;

      try {
        const { appKey, appSecret } = Config.get();
        if (!appKey || !appSecret) {
          isConnectingRef.current = false;
          return;
        }

        if (!approvalKeyRef.current) {
          approvalKeyRef.current = await getKisWsApprovalKey(appKey, appSecret);
        }

        const socket = new WebSocket(KIS_WS_URL);

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
                  invoke("broadcast_ticker_data", { symbol: parsedSymbol, data: parsed }).catch(console.error);
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
      const { activeSymbols } = Config.get();
      const activeSet = new Set(activeSymbols);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && approvalKeyRef.current) {
        // 새 종목 구독 (KRX + NXT 동시)
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

            // REST로 현재가 초기값 로드
            const { appKey, appSecret } = Config.get();
            if (appKey && appSecret) {
              fetchCurrentPrice(appKey, appSecret, symbol)
                .then(data => invoke("broadcast_ticker_data", { symbol, data }).catch(console.error))
                .catch(console.error);
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
          }
        }
      } else {
        if (activeSet.size > 0 && !isConnectingRef.current && !wsRef.current) {
          connectWs();
        } else if (activeSet.size === 0 && wsRef.current) {
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
