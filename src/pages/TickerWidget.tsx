import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import TickerCard from "../components/TickerCard";
import {
  fetchCurrentPriceUnified,
  fetchIntradayChart
} from "../lib/kisApi";
import * as kisVirtualApi from "../lib/kisVirtualApi";
import { Config } from "../lib/storage";
import { StockData } from "../lib/types";

export default function TickerWidget() {
  const { symbol } = useParams<{ symbol: string }>();
  const [tickerData, setTickerData] = useState<StockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [hideBorder, setHideBorder] = useState(false);
  const [scale, setScale] = useState(1.0);

  useEffect(() => {
    const setupEvents = async () => {
      // 초기 테두리 상태 로드
      setHideBorder(Config.get().hideBorder);

      const unlistenLock = await listen<boolean>("lock-toggled", (event) => {
        setIsLocked(event.payload);
      });
      const unlistenBorder = await listen<boolean>("border-toggled", (event) => {
        setHideBorder(event.payload);
      });
      const unlistenScale = await listen<number>("scale-changed", (event) => {
        setScale(event.payload);
      });
      setScale(Config.get().scale || 1.0);

      let moveTimeout: ReturnType<typeof setTimeout>;
      const unlistenMove = await listen("window-moved", () => {
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(async () => {
          if (!symbol) return;
          try {
            const appWindow = getCurrentWindow();
            const pos = await appWindow.innerPosition();
            const size = await appWindow.innerSize();
            Config.setTickerPos(symbol, { x: pos.x, y: pos.y, width: size.width, height: size.height });
          } catch (err) {
            console.error("Failed to save window state:", err);
          }
        }, 300); // 300ms debounce
      });

      return () => {
        unlistenLock();
        unlistenBorder();
        unlistenScale();
        unlistenMove();
        clearTimeout(moveTimeout);
      };
    };

    const unlistenPromise = setupEvents();
    return () => {
      unlistenPromise.then(fn => fn());
    };
  }, []);

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!symbol) return;
    setError(null);

    const loadInitialData = async () => {
      try {
        const { isVirtual } = Config.get();
        const { appKey, appSecret } = Config.getActiveKeys();
        if (!appKey || !appSecret) return;

        const fetchPrice = isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
        const fetchChart = isVirtual ? kisVirtualApi.fetchVirtualIntradayChart : fetchIntradayChart;

        // 현재가 먼저 로드 (TPS 제한 방지위해 순차 호출)
        const priceData = await fetchPrice(appKey, appSecret, symbol);
        setTickerData({
          ...priceData,
          dataSource: 'KIS',
          updatedAt: Date.now(),
        });

        // 잠시 후 차트 로드 (TPS 제한 방지: 600ms 간격)
        setTimeout(async () => {
          try {
            const chartData = await fetchChart(appKey, appSecret, symbol);
            if (chartData.length > 0) {
              setTickerData(prev => prev ? { ...prev, intradayPrices: chartData } : prev);
            }
          } catch (chartErr) {
            console.error("Chart load failed:", chartErr);
          }
        }, 800);
      } catch (err: any) {
        console.error("Initial load failed:", err);
      }
    };

    const setupListeners = async () => {
      const unlistenData = await listen<StockData>(`kis-ticker-data-${symbol}`, (event) => {
        setError(null);
        // 이벤트 수신 시 기존 데이터와 병합: intradayPrices만 있으면 현재가 유지
        setTickerData(prev => {
          const incoming = event.payload;
          if (!prev) return incoming;
          // currentPrice가 없거나 0인 경우 기존 값 유지
          const hasValidPrice = incoming.currentPrice !== undefined && incoming.currentPrice !== null && incoming.currentPrice !== 0;
          return {
            ...prev,
            ...incoming,
            currentPrice: hasValidPrice ? incoming.currentPrice : prev.currentPrice,
            changeRate: hasValidPrice ? incoming.changeRate : prev.changeRate,
            isUp: hasValidPrice ? incoming.isUp : prev.isUp,
            isDown: hasValidPrice ? incoming.isDown : prev.isDown,
          };
        });
      });

      const unlistenError = await listen<string>(`kis-ticker-error-${symbol}`, (event) => {
        setError(event.payload);
      });

      return () => {
        unlistenData();
        unlistenError();
      };
    };

    loadInitialData();
    const cleanupPromise = setupListeners();

    return () => {
      cleanupPromise.then(fn => fn());
    };
  }, [symbol, retryCount]);

  const handleClose = async () => {
    if (symbol) Config.removeActiveSymbol(symbol);
    await invoke("close_window", { label: `ticker_${symbol?.replace(".", "_")}` });
  };



  const handleDoubleClick = async () => {
    if (!symbol) return;
    try {
      // 네이버 금융 개별 종목 페이지 혹은 지수 페이지 (지수 코드는 자리수가 다름)
      // 현재 우리 앱 설정 기준으로 0001 등 4자리는 지수, 6자리는 주식
      const isIndex = symbol.length <= 4;
      const url = isIndex
        ? `https://finance.naver.com/sise/sise_index.nhn?code=${symbol}`
        : `https://finance.naver.com/item/main.naver?code=${symbol}`;
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open browser:", err);
    }
  };

  if (error) {
    return (
      <div
        className={`flex items-center justify-center w-full h-full relative group p-2 transition-all duration-300 ${!hideBorder ? 'ring-2 ring-white/10 bg-zinc-900/90 rounded-xl border border-white/5 shadow-2xl' : ''}`}
        style={{ WebkitAppRegion: "drag", backgroundColor: "transparent" } as React.CSSProperties}
      >
        {!isLocked && (
          <button
            onClick={handleClose}
            className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 z-50 shadow-lg border border-white/20 group/btn"
          >
            <X size={12} className="group-hover/btn:scale-110 transition-transform" />
          </button>
        )}
        <div
          onClick={() => {
            setError(null);
            setTickerData(null);
            setRetryCount(c => c + 1);
          }}
          className="bg-red-900/80 text-red-200 text-[10px] px-3 py-1.5 rounded-lg border border-red-500/30 backdrop-blur-md font-medium text-center cursor-pointer hover:bg-red-900 transition-colors"
          title="클릭하여 연결 재시도"
          style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
        >
          {symbol}: {error}
        </div>
      </div>
    );
  }

  if (!tickerData) {
    return (
      <div
        className={`flex flex-col items-center justify-center w-full h-full gap-1 relative overflow-hidden p-2 transition-all duration-300 ${!hideBorder ? 'ring-2 ring-white/10 bg-zinc-900/90 rounded-xl border border-white/5 shadow-2xl' : ''}`}
        style={{ WebkitAppRegion: "drag", backgroundColor: "transparent" } as React.CSSProperties}
      >
        {!isLocked && (
          <button
            onClick={handleClose}
            className="absolute -top-1.5 -right-1.5 bg-zinc-800 text-white rounded-full p-1 hover:bg-red-600 z-50 border border-white/10 shadow-lg group/btn"
          >
            <X size={12} className="group-hover/btn:scale-110 transition-transform" />
          </button>
        )}
        <div
          onClick={() => setRetryCount(c => c + 1)}
          className="bg-black/60 text-white/80 text-[10px] px-4 py-2 rounded-full border border-white/10 backdrop-blur-md animate-pulse italic font-light tracking-wider cursor-pointer hover:bg-black/80 transition-colors"
          title="현재 상태에 멈춰있다면 클릭하여 재시도하세요"
          style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
        >
          {symbol}...
        </div>
      </div>
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={`w-full h-full flex items-center p-2 select-none relative transition-all duration-300 ${!hideBorder ? 'ring-2 ring-white/10 bg-zinc-900/90 rounded-xl border border-white/5 shadow-2xl' : ''}`}
      style={{ WebkitAppRegion: "drag", backgroundColor: "transparent" } as React.CSSProperties}
    >
      {!isLocked && (
        <button
          onClick={handleClose}
          className="absolute -top-1.5 -right-1.5 bg-zinc-900 text-white rounded-full p-1 hover:bg-red-600 z-50 shadow-2xl border border-white/20 group/btn"
          title="닫기"
        >
          <X size={12} className="group-hover/btn:scale-110 transition-transform" />
        </button>
      )}
      <div className="w-full h-full flex items-center justify-center" style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        <TickerCard data={tickerData} isLocked={isLocked} />
      </div>
    </div>
  );
}
