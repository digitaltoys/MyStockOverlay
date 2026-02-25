import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getKisWsApprovalKey,
  getKisWsSubscriptionMessage,
  parseTickerData,
  fetchCurrentPrice
} from "../lib/kisApi";

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
        const appKey = localStorage.getItem("mystockoverlay_app_key");
        const appSecret = localStorage.getItem("mystockoverlay_app_secret");

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
                  const parsed = parseTickerData(parsedSymbol, rawData);
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
                    if (s && trId === "H0STCNT0") {
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
      const activeStr = localStorage.getItem("mystockoverlay_active_symbols") || "[]";
      let active: string[] = [];
      try { active = JSON.parse(activeStr); } catch (e) { }

      const activeSet = new Set(active);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && approvalKeyRef.current) {
        // 새 종목 구독 (KRX + NXT 동시)
        for (const symbol of activeSet) {
          if (!subscribedRefs.current.has(symbol)) {
            wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0STCNT0"));
            wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, true, "H0NXCNT0"));
            subscribedRefs.current.add(symbol);

            // REST로 현재가 초기값 로드
            const appKey = localStorage.getItem("mystockoverlay_app_key");
            const appSecret = localStorage.getItem("mystockoverlay_app_secret");
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
            wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0STCNT0"));
            wsRef.current.send(getKisWsSubscriptionMessage(approvalKeyRef.current, symbol, false, "H0NXCNT0"));
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
