import { Minus } from "lucide-react";
import { KisTickerData } from "../lib/kisApi";

interface TickerCardProps {
  data: KisTickerData;
  isLocked?: boolean;
}

export default function TickerCard({ data, isLocked = true }: TickerCardProps) {
  const { symbol, currentPrice, changeRate, isUp, isDown } = data;

  const colorClass = isUp
    ? "text-red-400"
    : isDown
      ? "text-blue-400"
      : "text-zinc-300";

  const displayPrice = typeof currentPrice === 'number' ? currentPrice.toLocaleString() : currentPrice;
  const displayRate = typeof changeRate === 'number' ? Math.abs(changeRate).toFixed(2) : Math.abs(Number(changeRate) || 0).toFixed(2);

  return (
    <div className={`flex items-center gap-3 w-full h-full font-sans transition-opacity duration-500 ${!isLocked ? 'opacity-90 relative' : 'opacity-100'} px-1`}>
      {/* Left side: Symbol Display */}
      <div className="flex items-center gap-2 flex-shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-bold text-white/40 leading-none uppercase tracking-tighter truncate">
            {symbol}
          </span>
          <span className="text-sm font-black text-white leading-tight mt-0.5 tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] truncate max-w-[120px]">
            {symbol === "005930" ? "삼성전자"
              : symbol === "122630" ? "KODEX 레버리지"
                : symbol === "0001" ? "코스피"
                  : symbol === "1001" ? "코스닥"
                    : symbol === "2001" ? "KOSPI 200"
                      : symbol}
          </span>
        </div>
        <div className="h-6 w-[1px] bg-white/10 ml-1" />
      </div>

      {/* Right side: Price and Rate */}
      <div className="flex flex-col items-end min-w-0 pr-1 cursor-pointer hover:bg-white/5 rounded transition-colors" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <div className={`text-[19px] font-mono font-bold leading-none ${colorClass} tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,1)] truncate`}>
          {displayPrice}
        </div>
        <div className={`flex items-center gap-0.5 text-[12px] font-bold mt-1 ${colorClass} drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] truncate`}>
          {isUp ? <span className="text-[10px] leading-none mb-[1px]">▲</span> : isDown ? <span className="text-[10px] leading-none mb-[1px]">▼</span> : <Minus size={11} />}
          <span>{displayRate}%</span>
        </div>
      </div>

      {/* Visual Status Indicator (only show when unlocked) */}
      {!isLocked && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
          <div className={`w-1.5 h-1.5 rounded-full bg-white animate-ping`} />
        </div>
      )}
    </div>
  );
}
