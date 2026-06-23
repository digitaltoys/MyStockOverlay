import { useEffect, useRef, useState } from "react";
import { Config } from "../lib/storage";
import { useInitialLoad } from "../hooks/useInitialLoad";
import { useWebSocket } from "../hooks/useWebSocket";
import { useFallback } from "../hooks/useFallback";

/**
 * SRP: WsManager는 더 이상 직접 데이터를 수집하지 않고, 하위 훅(Hooks)들을 컴포지션하여
 * Config(설정) 변경을 감지하고 상태를 주입하는 "조정자(Coordinator)" 역할만 담당합니다.
 */
export default function WsManager() {
  // 전역 상태 (메모리 캐시)
  const activeSymbolsRef = useRef<Set<string>>(new Set());
  const chartDataRefs = useRef<Map<string, any[]>>(new Map());
  const lastUpdateTimesRef = useRef<Map<string, number>>(new Map());
  
  // 리렌더링 트리거 및 설정 동기화
  const [, setTick] = useState(0);

  // 1초 주기로 전역 Config의 activeSymbols 변경 여부를 감지하여 상태 업데이트
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const config = Config.get();
      let changed = false;

      // 새 종목이 추가되었거나 삭제되었는지 비교
      if (config.activeSymbols.length !== activeSymbolsRef.current.size) {
        changed = true;
      } else {
        for (const sym of config.activeSymbols) {
          if (!activeSymbolsRef.current.has(sym)) {
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        activeSymbolsRef.current = new Set(config.activeSymbols);
        setTick(t => t + 1); // 하위 훅들에게 변경 전파
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, []);

  // --- 분리된 로직(Custom Hooks) 연결 ---

  // 1. 앱 진입 시 / 종목 추가 시 1회 REST 조회
  useInitialLoad(activeSymbolsRef.current, chartDataRefs, lastUpdateTimesRef);

  // 2. 실시간 웹소켓 연결 및 차트 Append
  useWebSocket(activeSymbolsRef.current, chartDataRefs, lastUpdateTimesRef);

  // 3. WS 타임아웃 30초 초과 시 폴백 REST Polling
  useFallback(activeSymbolsRef.current, chartDataRefs, lastUpdateTimesRef);

  // 화면을 렌더링하지 않는 유령 컴포넌트
  return null;
}
