import { useMemo } from "react";
import { Config } from "../lib/storage";
import { useWebSocket } from "./useWebSocket";
import { useTossPolling } from "./useTossPolling";

/**
 * 실시간 동기화의 공통 진입점입니다.
 * 현재 데이터 소스 모드에 따라 KIS 웹소켓 또는 Toss 폴링을 선택합니다.
 */
export function useRealtimeSync(
  activeSymbols: Set<string>,
  chartDataRefs: React.MutableRefObject<Map<string, any[]>>,
  lastUpdateTimesRef: React.MutableRefObject<Map<string, number>>,
) {
  const config = Config.get();
  const mode = config.dataSourceMode;

  const realtimeFlags = useMemo(() => {
    return {
      kisEnabled: mode === "real" || mode === "virtual",
      tossEnabled: mode === "toss",
    };
  }, [mode]);

  useWebSocket(activeSymbols, chartDataRefs, lastUpdateTimesRef, realtimeFlags.kisEnabled);
  useTossPolling(activeSymbols, chartDataRefs, lastUpdateTimesRef, realtimeFlags.tossEnabled);
}
