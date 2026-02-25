import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Trash2, ExternalLink, Shield, Lock, Unlock, Keyboard, Settings, Monitor } from "lucide-react";
import WsManager from "../components/WsManager";

export default function ControlPanel() {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [tickerSymbols, setTickerSymbols] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [isLocked, setIsLocked] = useState(true);
  const [hideBorder, setHideBorder] = useState(false);

  const hasAutoLaunched = useRef(false);
  const launchingSymbols = useRef(new Set<string>());

  useEffect(() => {
    // Load saved settings
    const savedKey = localStorage.getItem("mystockoverlay_app_key");
    const savedSecret = localStorage.getItem("mystockoverlay_app_secret");
    const savedSymbols = localStorage.getItem("mystockoverlay_symbols");

    if (savedKey) setAppKey(savedKey);
    if (savedSecret) setAppSecret(savedSecret);
    if (savedSymbols) setTickerSymbols(JSON.parse(savedSymbols));

    const savedHideBorder = localStorage.getItem("mystockoverlay_hide_border");
    if (savedHideBorder) setHideBorder(savedHideBorder === "true");

    const savedIsLockedParams = localStorage.getItem("mystockoverlay_is_locked");
    let initialLockState = true;
    if (savedIsLockedParams) {
      initialLockState = savedIsLockedParams === "true";
      setIsLocked(initialLockState);
      // Sync the loaded lock state with the backend immediately
      invoke("toggle_lock_from_frontend", { locked: initialLockState }).catch(console.error);
    }

    // Auto-launch previously active tickers
    const savedActive = localStorage.getItem("mystockoverlay_active_symbols");
    if (savedActive && !hasAutoLaunched.current) {
      hasAutoLaunched.current = true;
      try {
        const activeSymbols: string[] = JSON.parse(savedActive);
        const spawnWindowsSequentially = async () => {
          for (let i = 0; i < activeSymbols.length; i++) {
            const symbol = activeSymbols[i];
            try {
              let posArgs: { x?: number, y?: number } = {};
              try {
                const savedPos = localStorage.getItem(`mystockoverlay_pos_${symbol}`);
                if (savedPos) posArgs = JSON.parse(savedPos);
                else posArgs = { x: 100 + i * 20, y: 100 + i * 20 };
              } catch (e) {
                posArgs = { x: 100 + i * 20, y: 100 + i * 20 };
              }

              launchingSymbols.current.add(symbol);
              await invoke("spawn_ticker_window", { symbol, ignoreMouse: initialLockState, ...posArgs });
              setTimeout(() => launchingSymbols.current.delete(symbol), 1000);
              // Add a tiny delay between spawns to ensure the window state plugin finishes its work
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
              console.error(`Failed to spawn ${symbol}:`, err);
            }
          }
        };
        spawnWindowsSequentially();
      } catch (e) { }
    }

    // Listen for lock toggles from global shortcut
    const unlisten = listen<boolean>("lock-toggled", (event) => {
      setIsLocked(event.payload);
      localStorage.setItem("mystockoverlay_is_locked", event.payload.toString());
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const saveConfig = () => {
    localStorage.setItem("mystockoverlay_app_key", appKey);
    localStorage.setItem("mystockoverlay_app_secret", appSecret);
    alert("설정이 저장되었습니다.");
  };

  const launchTicker = async (symbolToLaunch: string) => {
    const s = symbolToLaunch.trim();
    if (!s) return;
    if (launchingSymbols.current.has(s)) return;
    launchingSymbols.current.add(s);

    try {
      const activeStr = localStorage.getItem("mystockoverlay_active_symbols") || "[]";
      let active: string[] = JSON.parse(activeStr);
      if (!active.includes(s)) {
        active.push(s);
        localStorage.setItem("mystockoverlay_active_symbols", JSON.stringify(active));
      }

      let posArgs = {};
      try {
        const savedPos = localStorage.getItem(`mystockoverlay_pos_${s}`);
        if (savedPos) posArgs = JSON.parse(savedPos);
      } catch (e) { }

      await invoke("spawn_ticker_window", { symbol: s, ignoreMouse: isLocked, ...posArgs });
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
      localStorage.setItem("mystockoverlay_symbols", JSON.stringify(updated));
    }

    await launchTicker(s);
    setNewSymbol("");
  };

  const removeTicker = (symbol: string) => {
    const updated = tickerSymbols.filter(s => s !== symbol);
    setTickerSymbols(updated);
    localStorage.setItem("mystockoverlay_symbols", JSON.stringify(updated));

    try {
      const activeStr = localStorage.getItem("mystockoverlay_active_symbols") || "[]";
      let active: string[] = JSON.parse(activeStr);
      active = active.filter(s => s !== symbol);
      localStorage.setItem("mystockoverlay_active_symbols", JSON.stringify(active));
    } catch (e) { }

    // 창도 닫기
    invoke("close_window", { label: `ticker_${symbol.replace(".", "_")}` });
  };

  const launchAll = async () => {
    for (const symbol of tickerSymbols) {
      await launchTicker(symbol);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 p-8 font-sans selection:bg-zinc-500/30">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 pb-6 relative overflow-hidden group">
          <div className="absolute -inset-x-20 -top-20 h-40 bg-white/5 blur-[100px] pointer-events-none" />
          <div className="relative">
            <h1 className="text-4xl font-black bg-gradient-to-br from-white via-white to-zinc-600 bg-clip-text text-transparent tracking-tighter italic">
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
        <section className="bg-zinc-900/40 rounded-3xl p-6 border border-white/5 backdrop-blur-xl shadow-inner group/section">
          <div className="flex items-center gap-2 mb-6 text-zinc-400">
            <Settings size={18} className="group-hover/section:text-zinc-200 transition-colors" />
            <h2 className="text-lg font-bold tracking-tight">Global Settings</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 cursor-pointer hover:bg-white/10 transition-colors group">
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
                    localStorage.setItem("mystockoverlay_is_locked", newLockedState.toString());
                    await invoke("toggle_lock_from_frontend", { locked: newLockedState });
                  }}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full p-1 transition-colors ${!isLocked ? 'bg-orange-500' : 'bg-zinc-700'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${!isLocked ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </div>
            </label>

            <label className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 cursor-pointer hover:bg-white/10 transition-colors group" title="잠금 해제 상태일 때 보여지는 티커 배경 및 테두리를 숨깁니다">
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
                    localStorage.setItem("mystockoverlay_hide_border", hide.toString());
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
        </section>

        {/* Ticker Management */}
        <section className="bg-zinc-900/20 rounded-3xl p-8 border border-white/5">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold tracking-tighter">My Watchlist</h2>
            <button
              onClick={launchAll}
              className="px-4 py-2 border border-white/10 rounded-xl text-xs font-bold hover:bg-white/5 transition-colors flex items-center gap-2"
            >
              <ExternalLink size={14} />
              전체 띄우기
            </button>
          </div>

          <div className="flex gap-2 mb-8">
            <input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTicker()}
              placeholder="종목코드 입력 (예: 005930)"
              className="flex-1 bg-white/5 border border-white/5 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all text-sm font-medium"
            />
            <button
              onClick={addTicker}
              className="bg-zinc-800 text-white p-4 rounded-2xl hover:bg-zinc-700 active:scale-95 transition-all shadow-lg"
            >
              <Plus size={24} />
            </button>
          </div>

          <div className="grid gap-3">
            {tickerSymbols.map(symbol => (
              <div
                key={symbol}
                className="flex items-center justify-between p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-all group/item"
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
              <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
                <p className="text-zinc-600 text-sm font-medium tracking-tight">종목을 추가하여 실시간 시세를 확인하세요.</p>
              </div>
            )}
          </div>
        </section>

        {/* API Settings */}
        <section className="bg-zinc-900/40 rounded-3xl border border-white/5 p-8 backdrop-blur-xl shadow-inner group/section">
          <div className="flex items-center gap-2 mb-6 text-zinc-400">
            <Shield size={18} className="group-hover/section:text-zinc-200 transition-colors" />
            <h2 className="text-lg font-bold tracking-tight">KIS API Authentication</h2>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-widest ml-1">App Key</label>
              <input
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder="한국투자증권 App Key"
                className="w-full bg-black/50 border border-white/5 rounded-2xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-widest ml-1">App Secret</label>
              <input
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="한국투자증권 App Secret"
                className="w-full bg-black/50 border border-white/5 rounded-2xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all font-mono text-sm text-zinc-400"
              />
            </div>
            <button
              onClick={saveConfig}
              className="mt-2 bg-white text-black font-black py-4 rounded-2xl hover:bg-zinc-200 active:scale-[0.98] transition-all shadow-xl shadow-white/5 tracking-tighter text-sm uppercase"
            >
              인증 정보 저장
            </button>
          </div>
        </section>

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
      </div>
      <WsManager />
    </div>
  );
}
