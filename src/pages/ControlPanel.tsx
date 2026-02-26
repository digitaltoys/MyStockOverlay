import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Trash2, ExternalLink, Shield, Lock, Unlock, Keyboard, Settings, Monitor } from "lucide-react";
import WsManager from "../components/WsManager";
import { Config, KisAuthStorage } from "../lib/storage";

export default function ControlPanel() {
  const [realAppKey, setRealAppKey] = useState("");
  const [realAppSecret, setRealAppSecret] = useState("");
  const [virtualAppKey, setVirtualAppKey] = useState("");
  const [virtualAppSecret, setVirtualAppSecret] = useState("");
  const [tickerSymbols, setTickerSymbols] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [isLocked, setIsLocked] = useState(true);
  const [hideBorder, setHideBorder] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [enableKis, setEnableKis] = useState(true);
  const [enableFallback, setEnableFallback] = useState(true);
  const [isVirtual, setIsVirtual] = useState(false);

  const hasAutoLaunched = useRef(false);
  const launchingSymbols = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);
  const [scrollbarThumbHeight, setScrollbarThumbHeight] = useState(0);
  const [scrollbarThumbTop, setScrollbarThumbTop] = useState(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const ratio = el.clientHeight / el.scrollHeight;
    setScrollbarThumbHeight(ratio * el.clientHeight);
    setScrollbarThumbTop((el.scrollTop / el.scrollHeight) * el.clientHeight);
    setScrollbarVisible(true);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => setScrollbarVisible(false), 1000);
  };

  useEffect(() => {
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
  }, []);


  useEffect(() => {
    // Load saved settings
    const config = Config.get();
    // 실/모의 키 로드
    setRealAppKey(config.realAppKey || config.appKey || "");
    setRealAppSecret(config.realAppSecret || config.appSecret || "");
    setVirtualAppKey(config.virtualAppKey || config.appKey || "");
    setVirtualAppSecret(config.virtualAppSecret || config.appSecret || "");
    if (config.symbols.length) setTickerSymbols(config.symbols);
    setHideBorder(config.hideBorder);
    setScale(config.scale || 1.0);
    setEnableKis(config.enableKis !== false);
    setEnableFallback(config.enableFallback !== false);
    setIsVirtual(!!config.isVirtual);

    const initialLockState = config.isLocked;
    setIsLocked(initialLockState);
    invoke("toggle_lock_from_frontend", { locked: initialLockState }).catch(console.error);

    // Auto-launch previously active tickers
    if (config.activeSymbols.length && !hasAutoLaunched.current) {
      hasAutoLaunched.current = true;
      const spawnWindowsSequentially = async () => {
        for (let i = 0; i < config.activeSymbols.length; i++) {
          const symbol = config.activeSymbols[i];
          try {
            const savedPos = Config.getTickerPos(symbol);
            const posArgs = savedPos ?? { x: 100 + i * 20, y: 100 + i * 20 };
            launchingSymbols.current.add(symbol);
            await invoke("spawn_ticker_window", { symbol, ignoreMouse: initialLockState, ...posArgs });
            setTimeout(() => launchingSymbols.current.delete(symbol), 1000);
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            console.error(`Failed to spawn ${symbol}:`, err);
          }
        }
      };
      spawnWindowsSequentially();
    }

    // Listen for lock toggles from global shortcut
    const unlisten = listen<boolean>("lock-toggled", (event) => {
      setIsLocked(event.payload);
      Config.set({ isLocked: event.payload });
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const saveRealConfig = () => {
    Config.set({ realAppKey, realAppSecret });
    KisAuthStorage.clear();
    alert("실계좌 인증 정보가 저장되었습니다.");
  };

  const saveVirtualConfig = () => {
    Config.set({ virtualAppKey, virtualAppSecret });
    KisAuthStorage.clear();
    alert("모의투자 인증 정보가 저장되었습니다.");
  };

  const launchTicker = async (symbolToLaunch: string) => {
    const s = symbolToLaunch.trim();
    if (!s) return;
    if (launchingSymbols.current.has(s)) return;
    launchingSymbols.current.add(s);

    try {
      Config.addActiveSymbol(s);
      const savedPos = Config.getTickerPos(s);
      await invoke("spawn_ticker_window", { symbol: s, ignoreMouse: isLocked, ...(savedPos ?? {}) });
    } catch (err) {
      console.error("Failed to spawn window:", err);
    } finally {
      setTimeout(() => launchingSymbols.current.delete(s), 1000);
    }
  };

  const addTicker = async () => {
    const s = newSymbol.trim();
    if (!s) return;
    if (!tickerSymbols.includes(s)) {
      const updated = [...tickerSymbols, s];
      setTickerSymbols(updated);
      Config.set({ symbols: updated });
    }
    await launchTicker(s);
    setNewSymbol("");
  };

  const removeTicker = (symbol: string) => {
    const updated = tickerSymbols.filter(s => s !== symbol);
    setTickerSymbols(updated);
    Config.set({ symbols: updated });
    Config.removeActiveSymbol(symbol);
    invoke("close_window", { label: `ticker_${symbol.replace(".", "_")}` });
  };

  const launchAll = async () => {
    for (const symbol of tickerSymbols) {
      await launchTicker(symbol);
    }
  };

  return (
    <div
      ref={scrollRef}
      className="relative h-screen overflow-y-auto bg-[#0a0a0a] text-zinc-100 p-4 font-sans selection:bg-zinc-500/30"
      onScroll={handleScroll}
    >
      {/* Custom overlay scrollbar */}
      <div className="fixed right-0 top-0 bottom-0 w-2 z-50 pointer-events-none">
        <div
          className="absolute right-0.5 rounded-full transition-opacity duration-300"
          style={{
            background: 'rgba(255,255,255,0.2)',
            width: '4px',
            height: scrollbarThumbHeight,
            top: scrollbarThumbTop,
            opacity: scrollbarVisible ? 1 : 0,
          }}
        />
      </div>
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 pb-4 relative overflow-hidden group">
          <div className="absolute -inset-x-20 -top-20 h-40 bg-white/5 blur-[100px] pointer-events-none" />
          <div className="relative">
            <h1 className="text-3xl font-black bg-gradient-to-br from-white via-white to-zinc-600 bg-clip-text text-transparent tracking-tighter italic">
              MyStockOverlay
            </h1>
            <p className="text-zinc-500 text-sm mt-1 font-medium tracking-tight">Lightweight, always-on-top stock ticker</p>
          </div>

          <div className={`flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all duration-700 shadow-2xl relative z-10 ${isLocked ? 'bg-zinc-900/50 border-white/5' : 'bg-zinc-100 border-white ring-4 ring-orange-500/20'}`}>
            <div className={`p-1.5 rounded-lg ${isLocked ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-900 text-white'}`}>
              {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
            </div>
            <div className="flex flex-col pr-1">
              <span className={`text-[11px] font-black uppercase tracking-widest ${isLocked ? 'text-zinc-500' : 'text-zinc-900'}`}>
                {isLocked ? "System Locked" : "Unlocked Mode"}
              </span>
              <span className={`text-[10px] font-mono whitespace-nowrap ${isLocked ? 'text-zinc-700' : 'text-zinc-500'}`}>
                Ctrl + Shift + L
              </span>
            </div>
          </div>
        </header>

        {/* Global Settings */}
        <section className="bg-zinc-900/40 rounded-2xl p-4 border border-white/5 backdrop-blur-xl shadow-inner group/section">
          <div className="flex items-center gap-2 mb-3 text-zinc-400">
            <Settings size={16} className="group-hover/section:text-zinc-200 transition-colors" />
            <h2 className="text-base font-bold tracking-tight">Global Settings</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 cursor-pointer hover:bg-white/10 transition-colors group">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border transition-colors ${!isLocked ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' : 'bg-black/50 border-white/10 text-zinc-500'}`}>
                  {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                </div>
                <div className="flex flex-col">
                  <span className={`text-sm font-bold tracking-tight ${!isLocked ? 'text-white' : 'text-zinc-300'}`}>Unlock Tickers</span>
                  <span className="text-[10px] text-zinc-500 font-mono mt-0.5">Ctrl+Shift+L</span>
                </div>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={!isLocked}
                  onChange={async (e) => {
                    const unlocked = e.target.checked;
                    const newLockedState = !unlocked;
                    setIsLocked(newLockedState);
                    Config.set({ isLocked: newLockedState });
                    await invoke("toggle_lock_from_frontend", { locked: newLockedState });
                  }}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full p-1 transition-colors ${!isLocked ? 'bg-orange-500' : 'bg-zinc-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${!isLocked ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </div>
            </label>

            <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 cursor-pointer hover:bg-white/10 transition-colors group" title="잠금 해제 상태일 때 보여지는 티커 배경 및 테두리를 숨깁니다">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border transition-colors ${hideBorder ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' : 'bg-black/50 border-white/10 text-zinc-500'}`}>
                  <Settings size={16} />
                </div>
                <div className="flex flex-col">
                  <span className={`text-sm font-bold tracking-tight ${hideBorder ? 'text-white' : 'text-zinc-300'}`}>Hide Border</span>
                  <span className="text-[10px] text-zinc-500 font-medium mt-0.5 whitespace-nowrap">투명 배경 전용</span>
                </div>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={hideBorder}
                  onChange={async (e) => {
                    const hide = e.target.checked;
                    setHideBorder(hide);
                    Config.set({ hideBorder: hide });
                    await invoke("broadcast_border_toggle", { hide });
                  }}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full p-1 transition-colors ${hideBorder ? 'bg-purple-500' : 'bg-zinc-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${hideBorder ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </div>
            </label>
          </div>

          {/* Scale Slider */}
          <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/20 border border-blue-500/50 text-blue-400">
                  <Settings size={16} />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-tight text-white">Ticker Scale</span>
                  <span className="text-[10px] text-zinc-500 font-medium mt-0.5">전체 크기 배율 조절</span>
                </div>
              </div>
              <span className="text-sm font-mono font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-md">
                {scale.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={scale}
              onChange={async (e) => {
                const newScale = parseFloat(e.target.value);
                setScale(newScale);
                Config.set({ scale: newScale });
                await invoke("broadcast_scale_changed", { scale: newScale });
              }}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between mt-1 px-1">
              <span className="text-[9px] text-zinc-600">0.5x</span>
              <span className="text-[9px] text-zinc-600">1.0x</span>
              <span className="text-[9px] text-zinc-600">2.0x</span>
            </div>
          </div>
        </section>

        {/* Ticker Management */}
        <section className="bg-zinc-900/20 rounded-2xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold tracking-tighter">My Watchlist</h2>
            <button
              onClick={launchAll}
              className="px-3 py-1.5 border border-white/10 rounded-lg text-xs font-bold hover:bg-white/5 transition-colors flex items-center gap-1.5"
            >
              <ExternalLink size={14} />
              전체 띄우기
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTicker()}
              placeholder="종목코드 입력 (예: 005930, 0001)"
              className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all text-sm font-medium"
            />
            <button
              onClick={addTicker}
              className="bg-zinc-800 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700 active:scale-95 transition-all shadow-lg flex items-center justify-center"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="grid gap-3">
            {tickerSymbols.map(symbol => (
              <div
                key={symbol}
                className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-all group/item"
              >
                <div className="flex items-center gap-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 group-hover/item:bg-white transition-colors" />
                  <span className="font-mono text-sm tracking-widest font-bold text-zinc-300">
                    {symbol}
                  </span>
                  <span className="text-xs text-zinc-500 font-medium">
                    {symbol === "005930" ? "삼성전자" : symbol === "122630" ? "KODEX 레버리지" : ""}
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                  <button
                    onClick={() => invoke("reset_window_state", { label: `ticker_${symbol.replace(".", "_")}` }).catch(console.error)}
                    className="p-2 text-zinc-500 hover:text-green-400 hover:bg-green-400/5 rounded-lg transition-all"
                    title="창 위치 및 크기 초기화"
                  >
                    <Monitor size={16} />
                  </button>
                  <button
                    onClick={() => launchTicker(symbol)}
                    className="p-2 text-zinc-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                    title="독립 창 열기"
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    onClick={() => removeTicker(symbol)}
                    className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-all"
                    title="삭제"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {tickerSymbols.length === 0 && (
              <div className="text-center py-10 border-2 border-dashed border-white/5 rounded-xl">
                <p className="text-zinc-600 text-sm font-medium tracking-tight">종목을 추가하여 실시간 시세를 확인하세요.</p>
              </div>
            )}
          </div>
        </section>

        {/* API Settings */}
        <div className="grid gap-4">
          {/* KIS API 공통 헤더 + 활성화 토글 */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-zinc-400">
              <Shield size={16} className={`${enableKis ? 'text-blue-400' : ''}`} />
              <span className="text-base font-bold tracking-tight">한국투자증권 KIS API</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${enableKis ? 'text-blue-400' : 'text-zinc-600'}`}>
                {enableKis ? 'Active' : 'Disabled'}
              </span>
              <input
                type="checkbox"
                checked={enableKis}
                onChange={(e) => {
                  const val = e.target.checked;
                  setEnableKis(val);
                  Config.set({ enableKis: val });
                }}
                className="sr-only"
                id="kis-toggle"
              />
              <label
                htmlFor="kis-toggle"
                className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${enableKis ? 'bg-blue-500' : 'bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableKis ? 'translate-x-4' : 'translate-x-0'}`} />
              </label>
            </div>
          </div>

          {/* 활성 모드 표시 */}
          <div className="flex items-center gap-3 px-1">
            <button
              onClick={() => { setIsVirtual(true); Config.set({ isVirtual: true }); KisAuthStorage.clear(); }}
              className={`text-[10px] font-black px-3 py-1 rounded-lg transition-all ${isVirtual ? 'bg-purple-500 text-white shadow-purple-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500'}`}
            >🧪 VIRTUAL (모의)</button>
            <button
              onClick={() => { setIsVirtual(false); Config.set({ isVirtual: false }); KisAuthStorage.clear(); }}
              className={`text-[10px] font-black px-3 py-1 rounded-lg transition-all ${!isVirtual ? 'bg-blue-500 text-white shadow-blue-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500'}`}
            >💼 REAL (실계좌)</button>
            <span className="text-[10px] text-zinc-600 font-medium ml-1">현재: {isVirtual ? '모의투자' : '실계좌'} 모드로 동작 중</span>
          </div>

          {/* 실계좌 Key 카드 */}
          <section className={`bg-zinc-900/40 rounded-2xl border transition-all duration-300 ${!isVirtual ? 'border-blue-500/50 shadow-blue-500/5 shadow-lg' : 'border-white/5'} p-5 backdrop-blur-xl`}>
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${!isVirtual ? 'bg-blue-400 animate-pulse' : 'bg-zinc-700'}`} />
              <span className="text-sm font-black tracking-tight text-zinc-300">💼 실계좌 (Real)</span>
              {!isVirtual && <span className="text-[9px] font-black bg-blue-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>}
            </div>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Key</label>
                <input
                  value={realAppKey}
                  onChange={(e) => setRealAppKey(e.target.value)}
                  placeholder="실계좌 App Key"
                  disabled={!enableKis}
                  className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-xs disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Secret</label>
                <input
                  type="password"
                  value={realAppSecret}
                  onChange={(e) => setRealAppSecret(e.target.value)}
                  placeholder="실계좌 App Secret"
                  disabled={!enableKis}
                  className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-xs text-zinc-400 disabled:opacity-50"
                />
              </div>
              <button
                onClick={saveRealConfig}
                disabled={!enableKis}
                className="mt-1 font-black py-2.5 rounded-xl active:scale-[0.98] transition-all text-xs uppercase disabled:opacity-50 bg-blue-500 text-white hover:bg-blue-400"
              >
                실계좌 키 저장
              </button>
            </div>
          </section>

          {/* 모의투자 Key 카드 */}
          <section className={`bg-zinc-900/40 rounded-2xl border transition-all duration-300 ${isVirtual ? 'border-purple-500/50 shadow-purple-500/5 shadow-lg' : 'border-white/5'} p-5 backdrop-blur-xl`}>
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${isVirtual ? 'bg-purple-400 animate-pulse' : 'bg-zinc-700'}`} />
              <span className="text-sm font-black tracking-tight text-zinc-300">🧪 모의투자 (Virtual)</span>
              {isVirtual && <span className="text-[9px] font-black bg-purple-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>}
            </div>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Key</label>
                <input
                  value={virtualAppKey}
                  onChange={(e) => setVirtualAppKey(e.target.value)}
                  placeholder="모의투자 App Key"
                  disabled={!enableKis}
                  className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-mono text-xs disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Secret</label>
                <input
                  type="password"
                  value={virtualAppSecret}
                  onChange={(e) => setVirtualAppSecret(e.target.value)}
                  placeholder="모의투자 App Secret"
                  disabled={!enableKis}
                  className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-mono text-xs text-zinc-400 disabled:opacity-50"
                />
              </div>
              <button
                onClick={saveVirtualConfig}
                disabled={!enableKis}
                className="mt-1 font-black py-2.5 rounded-xl active:scale-[0.98] transition-all text-xs uppercase disabled:opacity-50 bg-purple-500 text-white hover:bg-purple-400"
              >
                모의투자 키 저장
              </button>
            </div>
          </section>

          {/* Yahoo Finance Fallback Section */}
          <section className={`bg-zinc-900/40 rounded-2xl border transition-all duration-300 ${enableFallback ? 'border-yellow-500/30' : 'border-white/5 opacity-60'} p-5 backdrop-blur-xl shadow-inner`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-400">
                <ExternalLink size={16} className={`${enableFallback ? 'text-yellow-500' : ''}`} />
                <div className="flex flex-col">
                  <h2 className="text-base font-bold tracking-tight leading-none">Yahoo Finance API</h2>
                  <p className="text-[10px] text-zinc-500 font-medium mt-1">KIS 장애 시 비상 데이터 소스 (15~20분 지연)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${enableFallback ? 'text-yellow-500' : 'text-zinc-600'}`}>
                  {enableFallback ? 'Active' : 'Disabled'}
                </span>
                <input
                  type="checkbox"
                  checked={enableFallback}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setEnableFallback(val);
                    Config.set({ enableFallback: val });
                  }}
                  className="sr-only"
                  id="fallback-toggle"
                />
                <label
                  htmlFor="fallback-toggle"
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${enableFallback ? 'bg-yellow-500' : 'bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableFallback ? 'translate-x-4' : 'translate-x-0'}`} />
                </label>
              </div>
            </div>
          </section>
        </div>

        {/* Utilities Footer */}
        <footer className="flex items-center justify-between px-4 text-zinc-600 text-[11px] font-medium tracking-tight">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-green-500" />
              <span>Backend Connected</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Keyboard size={12} />
            <span>Shortcut (Ctrl+Shift+L) Always Enabled</span>
          </div>
        </footer>
      </div >
      <WsManager />
    </div >
  );
}
