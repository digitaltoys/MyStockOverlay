import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Plus, Trash2, ExternalLink, Shield, Lock, Unlock, Keyboard,
  Settings, Monitor, ChevronDown, ChevronUp, TrendingUp, List,
  Pencil, Check, X, RefreshCw
} from "lucide-react";
import WsManager from "../components/WsManager";
import { Config, DataSourceMode, KisAuthStorage, MyStock, StockPurchase, TossAuthStorage } from "../lib/storage";
import { createMarketDataProvider } from "../lib/providers";

// ─── 내 주식 관리 패널 ──────────────────────────────────────────────

interface MyStockPanelProps {
  symbol: string;
  myStock: MyStock | undefined;
  onChange: (updated: MyStock) => void;
}

function MyStockPanel({ symbol, myStock, onChange }: MyStockPanelProps) {
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");

  // 편집 상태
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editQty, setEditQty] = useState("");

  const purchases: StockPurchase[] = myStock?.purchases ?? [];

  // 평단가 계산
  const totalShares = purchases.reduce((acc, p) => acc + p.qty, 0);
  const avgPrice = totalShares > 0
    ? Math.round(purchases.reduce((acc, p) => acc + p.price * p.qty, 0) / totalShares)
    : 0;

  const addPurchase = () => {
    const p = parseFloat(price.replace(/,/g, ""));
    const q = parseInt(qty.replace(/,/g, ""), 10);
    if (isNaN(p) || p <= 0 || isNaN(q) || q <= 0) return;
    const newPurchases: StockPurchase[] = [...purchases, { price: p, qty: q }];
    onChange({ symbol, purchases: newPurchases });
    setPrice("");
    setQty("");
  };

  const removePurchase = (idx: number) => {
    const newPurchases = purchases.filter((_, i) => i !== idx);
    onChange({ symbol, purchases: newPurchases });
    if (editingIdx === idx) setEditingIdx(null);
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditPrice(String(purchases[idx].price));
    setEditQty(String(purchases[idx].qty));
  };

  const confirmEdit = () => {
    if (editingIdx === null) return;
    const p = parseFloat(editPrice.replace(/,/g, ""));
    const q = parseInt(editQty.replace(/,/g, ""), 10);
    if (isNaN(p) || p <= 0 || isNaN(q) || q <= 0) return;
    const newPurchases = purchases.map((item, i) =>
      i === editingIdx ? { price: p, qty: q } : item
    );
    onChange({ symbol, purchases: newPurchases });
    setEditingIdx(null);
  };

  const cancelEdit = () => setEditingIdx(null);

  const fmt = (n: number) => n.toLocaleString("ko-KR");

  return (
    <div className="mt-3 border-t border-white/5 pt-3 space-y-3">
      {/* 계산 결과 요약 */}
      {totalShares > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
            <span className="text-[10px] text-emerald-400/70 font-black uppercase tracking-widest block">평단가</span>
            <span className="text-base font-black text-emerald-400 tracking-tight">
              {fmt(avgPrice)}원
            </span>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2">
            <span className="text-[10px] text-blue-400/70 font-black uppercase tracking-widest block">보유 수량</span>
            <span className="text-base font-black text-blue-400 tracking-tight">
              {fmt(totalShares)}주
            </span>
          </div>
        </div>
      )}

      {/* 매입 이력 목록 */}
      {purchases.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest ml-0.5">매입 이력</p>
          {purchases.map((p, i) => {
            const isEditing = editingIdx === i;
            return (
              <div
                key={i}
                className={`rounded-lg transition-colors group/row ${
                  isEditing
                    ? "bg-zinc-800/80 border border-white/10 ring-1 ring-amber-500/30"
                    : "hover:bg-white/5"
                }`}
              >
                {isEditing ? (
                  /* ── 편집 모드 ── */
                  <div className="flex items-center gap-2 px-2 py-2">
                    <span className="text-[11px] text-zinc-500 font-mono w-4 shrink-0">{i + 1}</span>
                    <input
                      autoFocus
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      type="number"
                      placeholder="매입가"
                      className="flex-1 min-w-0 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-sm font-mono text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                    <input
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      type="number"
                      placeholder="수량"
                      className="w-20 shrink-0 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-sm font-mono text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                    <button
                      onClick={confirmEdit}
                      className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all"
                      title="저장 (Enter)"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1.5 text-zinc-500 hover:bg-white/5 rounded-lg transition-all"
                      title="취소 (Esc)"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  /* ── 보기 모드 ── */
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] text-zinc-500 font-mono w-4">{i + 1}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-zinc-300 font-mono">{fmt(p.price)}</span>
                        <span className="text-[10px] text-zinc-600">원</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-zinc-400 font-mono">{fmt(p.qty)}</span>
                        <span className="text-[10px] text-zinc-600">주</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(i)}
                        className="p-1.5 text-zinc-600 hover:text-amber-400 hover:bg-amber-400/5 rounded-lg transition-all"
                        title="수정"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => removePurchase(i)}
                        className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-all"
                        title="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 매입 추가 입력 */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPurchase()}
            placeholder="매입가 (원)"
            type="number"
            className="w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono placeholder:text-zinc-700"
          />
        </div>
        <div className="flex-1 relative">
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPurchase()}
            placeholder="수량 (주)"
            type="number"
            className="w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono placeholder:text-zinc-700"
          />
        </div>
        <button
          onClick={addPurchase}
          className="bg-zinc-800 hover:bg-zinc-700 active:scale-95 transition-all text-white px-3 py-2 rounded-xl shadow-lg flex items-center justify-center"
          title="매입 추가"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────

type Tab = "stocks" | "settings";

export default function ControlPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("stocks");

  // API / lock 상태
  const [realAppKey, setRealAppKey] = useState("");
  const [realAppSecret, setRealAppSecret] = useState("");
  const [virtualAppKey, setVirtualAppKey] = useState("");
  const [virtualAppSecret, setVirtualAppSecret] = useState("");
  const [tossClientId, setTossClientId] = useState("");
  const [tossClientSecret, setTossClientSecret] = useState("");
  const [tossPollingIntervalSec, setTossPollingIntervalSec] = useState(10);
  const [isLocked, setIsLocked] = useState(true);
  const [hideBorder, setHideBorder] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>("real");

  // 종목 목록
  const [tickerSymbols, setTickerSymbols] = useState<string[]>([]);
  const [tickerDisplayNames, setTickerDisplayNames] = useState<Record<string, string>>({});
  const [newSymbol, setNewSymbol] = useState("");

  // 내 주식 데이터
  const [myStocks, setMyStocks] = useState<MyStock[]>([]);

  // 종목 카드 펼치기 상태
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

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
    const config = Config.get();
    setRealAppKey(config.apis.kis.appKey);
    setRealAppSecret(config.apis.kis.appSecret);
    setVirtualAppKey(config.apis.kisVirtual.appKey);
    setVirtualAppSecret(config.apis.kisVirtual.appSecret);
    setTossClientId(config.apis.toss.clientId);
    setTossClientSecret(config.apis.toss.clientSecret);
    setTossPollingIntervalSec(config.tossPollingIntervalSec);
    if (config.symbols.length) setTickerSymbols(config.symbols);
    setHideBorder(config.hideBorder);
    setScale(config.scale || 1.0);
    setDataSourceMode(config.dataSourceMode);
    setMyStocks(config.myStocks || []);

    const initialLockState = config.isLocked;
    setIsLocked(initialLockState);
    invoke("toggle_lock_from_frontend", { locked: initialLockState }).catch(console.error);

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

    const unlisten = listen<boolean>("lock-toggled", (event) => {
      setIsLocked(event.payload);
      Config.set({ isLocked: event.payload });
    });

    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveTickerNames = async () => {
      const config = Config.get();
      if (tickerSymbols.length === 0) {
        setTickerDisplayNames({});
        return;
      }

      const provider = createMarketDataProvider(config);
      const entries = await Promise.allSettled(
        tickerSymbols.map(async (symbol) => {
          try {
            const priceData = await provider.fetchPrice(symbol);
            return [symbol, priceData.displayName ?? symbol] as const;
          } catch {
            return [symbol, symbol] as const;
          }
        })
      );

      if (cancelled) return;

      const nextNames: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.status === "fulfilled") {
          const [symbol, displayName] = entry.value;
          nextNames[symbol] = displayName;
        }
      }

      setTickerDisplayNames((prev) => ({ ...prev, ...nextNames }));
    };

    resolveTickerNames();

    return () => {
      cancelled = true;
    };
  }, [
    tickerSymbols,
    dataSourceMode,
    realAppKey,
    realAppSecret,
    virtualAppKey,
    virtualAppSecret,
    tossClientId,
    tossClientSecret,
  ]);

  // ─── 내 주식 업데이트 ─────────────────────────────────────────────

  const updateMyStock = (updated: MyStock) => {
    setMyStocks(prev => {
      const next = prev.filter(s => s.symbol !== updated.symbol);
      if (updated.purchases.length > 0) next.push(updated);
      Config.set({ myStocks: next });
      return next;
    });
  };

  const getMyStock = (symbol: string): MyStock | undefined =>
    myStocks.find(s => s.symbol === symbol);

  // ─── KIS 설정 저장 ────────────────────────────────────────────────

  const saveRealConfig = () => {
    const config = Config.get();
    Config.set({ apis: { ...config.apis, kis: { appKey: realAppKey, appSecret: realAppSecret } } });
    KisAuthStorage.clear(false);
    alert("실계좌 인증 정보가 저장되었습니다.");
  };

  const saveVirtualConfig = () => {
    const config = Config.get();
    Config.set({ apis: { ...config.apis, kisVirtual: { appKey: virtualAppKey, appSecret: virtualAppSecret } } });
    KisAuthStorage.clear(true);
    alert("모의투자 인증 정보가 저장되었습니다.");
  };

  const saveTossConfig = () => {
    const config = Config.get();
    Config.set({
      apis: {
        ...config.apis,
        toss: {
          clientId: tossClientId,
          clientSecret: tossClientSecret,
        },
      },
    });
    TossAuthStorage.clear();
    alert("토스 Open API 인증 정보가 저장되었습니다.");
  };

  const selectDataSourceMode = (mode: DataSourceMode) => {
    setDataSourceMode(mode);
    Config.setDataSourceMode(mode);

    if (mode === "real") {
      KisAuthStorage.clear(false);
      return;
    }

    if (mode === "virtual") {
      KisAuthStorage.clear(true);
      return;
    }

    if (mode === "toss") {
      TossAuthStorage.clear();
      return;
    }

    KisAuthStorage.clear();
  };

  const clearAuthTokens = () => {
    if (confirm("웹소켓 및 API 연결 인증 정보를 초기화하시겠습니까?\n강제로 새로운 세션과 접속 키를 발급받습니다.")) {
      KisAuthStorage.clear(); // 전체 환경(모의, 실전) 캐시 지움 (인자 없이 호출 시 전체 삭제하도록 storage에 되어있음)
      TossAuthStorage.clear();
      alert("인증 정보가 초기화되어 재연결을 시도합니다.");
    }
  };

  // ─── 티커 창 관리 ────────────────────────────────────────────────

  const launchTicker = async (symbolToLaunch: string) => {
    const s = symbolToLaunch.trim();
    if (!s || launchingSymbols.current.has(s)) return;
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
    const s = newSymbol.trim().toUpperCase();
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
    for (const symbol of tickerSymbols) await launchTicker(symbol);
  };

  // ─── 렌더링 ──────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "stocks", label: "주식 목록", icon: <List size={14} /> },
    { id: "settings", label: "설정", icon: <Settings size={14} /> },
  ];

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

        {/* ── Header ─────────────────────────────────── */}
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

        {/* ── Tab Bar ────────────────────────────────── */}
        <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-2xl border border-white/5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold tracking-tight transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-zinc-700 text-white shadow-lg"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
            TAB: 주식 목록
        ══════════════════════════════════════════════ */}
        {activeTab === "stocks" && (
          <div className="space-y-4">

            {/* Watchlist + My Stock */}
            <section className="bg-zinc-900/20 rounded-2xl p-5 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-zinc-400" />
                  <h2 className="text-lg font-bold tracking-tighter">My Watchlist</h2>
                </div>
                <button
                  onClick={launchAll}
                  className="px-3 py-1.5 border border-white/10 rounded-lg text-xs font-bold hover:bg-white/5 transition-colors flex items-center gap-1.5"
                >
                  <ExternalLink size={14} />
                  전체 띄우기
                </button>
              </div>

              {/* 종목 추가 입력 */}
              <div className="flex gap-2 mb-4">
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTicker()}
                  placeholder="종목코드 입력 (예: 0001, 005930, 122630)"
                  className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all text-sm font-medium"
                />
                <button
                  onClick={addTicker}
                  className="bg-zinc-800 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700 active:scale-95 transition-all shadow-lg flex items-center justify-center"
                >
                  <Plus size={20} />
                </button>
              </div>

              {/* 종목 카드 목록 */}
              <div className="grid gap-3">
                {tickerSymbols.map(symbol => {
                  const isExpanded = expandedSymbol === symbol;
                  const ms = getMyStock(symbol);
                  const totalShares = ms ? ms.purchases.reduce((a, p) => a + p.qty, 0) : 0;
                  const displayName = tickerDisplayNames[symbol] ?? symbol;

                  return (
                    <div
                      key={symbol}
                      className="bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-all group/item"
                    >
                      {/* 카드 헤더 */}
                      <div className="flex items-center justify-between p-3.5">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 group-hover/item:bg-white transition-colors" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-black tracking-tight text-zinc-100 truncate max-w-[220px]">
                              {displayName}
                            </span>
                            <span className="font-mono text-[10px] tracking-widest font-bold text-zinc-500 truncate max-w-[220px]">
                              {symbol}
                            </span>
                          </div>
                          {totalShares > 0 && (
                            <span className="text-[10px] font-black text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                              {totalShares.toLocaleString("ko-KR")}주 보유
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* 내 주식 관리 토글 버튼 */}
                          <button
                            onClick={() => setExpandedSymbol(isExpanded ? null : symbol)}
                            className={`p-2 rounded-lg transition-all text-xs font-bold flex items-center gap-1 ${
                              isExpanded
                                ? "text-emerald-400 bg-emerald-400/10"
                                : "text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/5"
                            }`}
                            title="내 주식 관리"
                          >
                            <TrendingUp size={14} />
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>

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
                      </div>

                      {/* 내 주식 관리 패널 (접기/펼치기) */}
                      {isExpanded && (
                        <div className="px-3.5 pb-3.5">
                          <MyStockPanel
                            symbol={symbol}
                            myStock={ms}
                            onChange={updateMyStock}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {tickerSymbols.length === 0 && (
                  <div className="text-center py-10 border-2 border-dashed border-white/5 rounded-xl">
                    <p className="text-zinc-600 text-sm font-medium tracking-tight">종목을 추가하여 실시간 시세를 확인하세요.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: 설정
        ══════════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <div className="space-y-4">

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
                        const newLockedState = !e.target.checked;
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

            {/* 데이터 소스 선택 */}
            <div className="grid gap-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Shield size={16} className="text-blue-400" />
                  <span className="text-base font-bold tracking-tight">데이터 소스</span>
                </div>
                <button
                  onClick={clearAuthTokens}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 bg-red-500/10 hover:bg-red-500/20 active:scale-95 transition-all"
                  title="세션 문제 발생 시 강제 초기화"
                >
                  <RefreshCw size={12} />
                  <span className="text-[10px] font-black tracking-tighter">세션 파기 및 재연결</span>
                </button>
              </div>

              <div className="grid gap-3 px-1">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <button
                    onClick={() => selectDataSourceMode("real")}
                    className={`text-[10px] font-black px-3 py-2 rounded-lg transition-all border ${dataSourceMode === 'real' ? 'bg-blue-500 text-white border-blue-400 shadow-blue-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500 border-white/5 hover:bg-zinc-700'}`}
                  >
                    💼 실계좌
                  </button>
                  <button
                    onClick={() => selectDataSourceMode("virtual")}
                    className={`text-[10px] font-black px-3 py-2 rounded-lg transition-all border ${dataSourceMode === 'virtual' ? 'bg-purple-500 text-white border-purple-400 shadow-purple-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500 border-white/5 hover:bg-zinc-700'}`}
                  >
                    🧪 모의투자
                  </button>
                  <button
                    onClick={() => selectDataSourceMode("yahoo")}
                    className={`text-[10px] font-black px-3 py-2 rounded-lg transition-all border ${dataSourceMode === 'yahoo' ? 'bg-yellow-500 text-white border-yellow-400 shadow-yellow-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500 border-white/5 hover:bg-zinc-700'}`}
                  >
                    🌐 Yahoo
                  </button>
                  <button
                    onClick={() => selectDataSourceMode("toss")}
                    className={`text-[10px] font-black px-3 py-2 rounded-lg transition-all border ${dataSourceMode === 'toss' ? 'bg-cyan-500 text-white border-cyan-400 shadow-cyan-500/20 shadow-lg' : 'bg-zinc-800 text-zinc-500 border-white/5 hover:bg-zinc-700'}`}
                  >
                    🧾 토스
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 font-medium">
                  현재 선택: {dataSourceMode === 'real' ? '실계좌' : dataSourceMode === 'virtual' ? '모의투자' : dataSourceMode === 'yahoo' ? 'Yahoo' : '토스'}
                </p>
              </div>

              {dataSourceMode === "real" && (
                <section className="bg-zinc-900/40 rounded-2xl border border-blue-500/50 shadow-blue-500/5 shadow-lg p-5 backdrop-blur-xl transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-sm font-black tracking-tight text-zinc-300">💼 실계좌 (Real)</span>
                    <span className="text-[9px] font-black bg-blue-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Key</label>
                      <input value={realAppKey} onChange={(e) => setRealAppKey(e.target.value)} placeholder="실계좌 App Key"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Secret</label>
                      <input type="password" value={realAppSecret} onChange={(e) => setRealAppSecret(e.target.value)} placeholder="실계좌 App Secret"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-xs text-zinc-400" />
                    </div>
                    <button onClick={saveRealConfig}
                      className="mt-1 font-black py-2.5 rounded-xl active:scale-[0.98] transition-all text-xs uppercase bg-blue-500 text-white hover:bg-blue-400">
                      실계좌 키 저장
                    </button>
                  </div>
                </section>
              )}

              {dataSourceMode === "virtual" && (
                <section className="bg-zinc-900/40 rounded-2xl border border-purple-500/50 shadow-purple-500/5 shadow-lg p-5 backdrop-blur-xl transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    <span className="text-sm font-black tracking-tight text-zinc-300">🧪 모의투자 (Virtual)</span>
                    <span className="text-[9px] font-black bg-purple-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Key</label>
                      <input value={virtualAppKey} onChange={(e) => setVirtualAppKey(e.target.value)} placeholder="모의투자 App Key"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">App Secret</label>
                      <input type="password" value={virtualAppSecret} onChange={(e) => setVirtualAppSecret(e.target.value)} placeholder="모의투자 App Secret"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-mono text-xs text-zinc-400" />
                    </div>
                    <button onClick={saveVirtualConfig}
                      className="mt-1 font-black py-2.5 rounded-xl active:scale-[0.98] transition-all text-xs uppercase bg-purple-500 text-white hover:bg-purple-400">
                      모의투자 키 저장
                    </button>
                  </div>
                </section>
              )}

              {dataSourceMode === "yahoo" && (
                <section className="bg-zinc-900/40 rounded-2xl border border-yellow-500/30 p-5 backdrop-blur-xl shadow-inner transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <ExternalLink size={16} className="text-yellow-500" />
                    <span className="text-sm font-black tracking-tight text-zinc-300">🌐 Yahoo Finance</span>
                    <span className="text-[9px] font-black bg-yellow-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Yahoo Finance를 현재 데이터 소스로 사용합니다.
                    별도의 App Key나 App Secret은 필요하지 않습니다.
                  </p>
                </section>
              )}

              {dataSourceMode === "toss" && (
                <section className="bg-zinc-900/40 rounded-2xl border border-cyan-500/30 p-5 backdrop-blur-xl shadow-inner transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <ExternalLink size={16} className="text-cyan-400" />
                    <span className="text-sm font-black tracking-tight text-zinc-300">🧾 토스 증권</span>
                    <span className="text-[9px] font-black bg-cyan-500 text-white px-1.5 py-0.5 rounded ml-auto">사용 중</span>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Client ID</label>
                      <input
                        value={tossClientId}
                        onChange={(e) => setTossClientId(e.target.value)}
                        placeholder="토스 Client ID"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Client Secret</label>
                      <input
                        type="password"
                        value={tossClientSecret}
                        onChange={(e) => setTossClientSecret(e.target.value)}
                        placeholder="토스 Client Secret"
                        className="w-full bg-black/50 border border-white/5 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono text-xs text-zinc-400"
                      />
                    </div>
                    <button
                      onClick={saveTossConfig}
                      className="mt-1 font-black py-2.5 rounded-xl active:scale-[0.98] transition-all text-xs uppercase bg-cyan-500 text-white hover:bg-cyan-400"
                    >
                      토스 키 저장
                    </button>
                    <div className="mt-1 p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold tracking-tight text-white">폴링 간격</span>
                          <span className="text-[10px] text-zinc-500 font-medium mt-0.5">토스 실시간 갱신 주기</span>
                        </div>
                        <span className="text-sm font-mono font-bold text-cyan-300 bg-cyan-400/10 px-2 py-0.5 rounded-md">
                          {tossPollingIntervalSec}초
                        </span>
                      </div>
                      <input
                        type="range"
                        min="3"
                        max="60"
                        step="1"
                        value={tossPollingIntervalSec}
                        onChange={(e) => {
                          const next = parseInt(e.target.value, 10);
                          setTossPollingIntervalSec(next);
                          Config.setTossPollingIntervalSec(next);
                        }}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                      />
                      <div className="flex justify-between mt-1 px-1">
                        <span className="text-[9px] text-zinc-600">3초</span>
                        <span className="text-[9px] text-zinc-600">30초</span>
                        <span className="text-[9px] text-zinc-600">60초</span>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      현재가와 분봉 차트를 직접 호출합니다. 웹소켓은 사용하지 않습니다.
                    </p>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────── */}
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
