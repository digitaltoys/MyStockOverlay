/**
 * chartCache.ts
 * 1분봉 API 페이징 호출을 최소화하기 위한 로컬 스토리지 캐시 매니저입니다.
 * 
 * 저장 구조:
 * KIS_CHART_CACHE: {
 *   [symbol: string]: {
 *     date: string;       // "YYYYMMDD" 형식. 오늘 날짜가 아니면 무시됨.
 *     items: {
 *       price: number;
 *       hour: string;     // "HHMMSS"
 *     }[]
 *   }
 * }
 */

const CACHE_KEY = 'KIS_CHART_CACHE';

interface ChartCacheItem {
  price: number;
  date: string;
  hour: string;
}

interface ChartCacheData {
  lastUpdated: string; // YYYYMMDD
  items: ChartCacheItem[];
  basePrice?: number;
}

type ChartCacheStore = Record<string, ChartCacheData>;

export class ChartCacheManager {
  /**
   * 특정 종목의 기준가(전일 종가)를 캐시에 저장
   */
  static updateBasePrice(symbol: string, basePrice: number): void {
    if (!basePrice || isNaN(basePrice)) return;
    const store = this.getStore();
    const today = this.getTodayString();
    
    if (!store[symbol]) {
      store[symbol] = {
        lastUpdated: today,
        items: [],
        basePrice
      };
    } else {
      store[symbol].basePrice = basePrice;
      store[symbol].lastUpdated = today;
    }
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  }
  /**
   * 오늘 날짜 문자열 반환 (YYYYMMDD)
   */
  static getTodayString(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  /**
   * 로컬 스토리지에서 전체 캐시 스토어 로드
   */
  private static getStore(): ChartCacheStore {
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      if (!saved) return {};
      return JSON.parse(saved) as ChartCacheStore;
    } catch {
      return {};
    }
  }

  /**
   * 특정 심볼의 캐시된 데이터를 가져옴
   * 어제와 오늘 날짜 데이터만 유지. 그 이전은 날려버림
   */
  static getCachedItems(symbol: string): ChartCacheItem[] {
    const store = this.getStore();
    const data = store[symbol];
    if (!data) return [];

    const today = this.getTodayString();
    
    // 단순 날짜 갱신 여부 판단: 오래 미접속일 경우 날리기
    if (data.lastUpdated < String(Number(today) - 5)) {
      delete store[symbol];
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));
      return [];
    }
    return data.items || [];
  }

  /**
   * 특정 심볼에 대해 캐시된 마지막(가장 최근) 데이터의 dateHour(YYYYMMDDHHMMSS) 반환 
   */
  static getLastCachedDateHour(symbol: string): string | null {
    let items = this.getCachedItems(symbol);
    if (items.length === 0) return null;
    
    // 결측치(Gap) 감지 로직: 오늘 정규장(J, 09:00~15:30) 데이터 중 15분 이상 빵꾸가 있거나 9시 개장 데이터가 없으면 다시 수집
    const today = this.getTodayString();
    const todayItems = items.filter(i => i.date === today && i.hour >= "090000" && i.hour <= "153000");
    
    if (todayItems.length > 0) {
      let hasGap = false;
      const now = new Date();
      const currentHourStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}00`;

      // 1. 개장(09:00) 직후 데이터가 통째로 누락되었는지 확인 (9시 30분이 넘었는데도 9시 30분 이전 데이터가 없을 경우)
      if (todayItems[0].hour > "093000" && currentHourStr > "093000") {
        hasGap = true;
      }

      // 2. 중간 빵꾸 확인 (거래 없는 시간대를 고려해 60분 이상 비어있을 떄만 치명적 결측치로 판단)
      if (!hasGap) {
        for (let i = 1; i < todayItems.length; i++) {
          const prevStr = todayItems[i - 1].hour;
          const currStr = todayItems[i].hour;
          
          const prevMins = parseInt(prevStr.slice(0, 2)) * 60 + parseInt(prevStr.slice(2, 4));
          const currMins = parseInt(currStr.slice(0, 2)) * 60 + parseInt(currStr.slice(2, 4));
          
          if (currMins - prevMins > 60) {
            hasGap = true;
            break;
          }
        }
      }

      // 무한 루프 방지: 방금 전에 이미 갭을 채우려고 다시 불러왔었다면 (lastUpdated 타임스탬프 체크 등) 연속 수집 유도 방지
      const store = this.getStore();
      const symbolData = store[symbol] as any;
      const alreadyClearedToday = symbolData?.lastGapCleared === today;

      // 결측치가 발견되고 오늘 강제 수집 유도를 한 적이 없다면, 기존 캐시를 보존한 채 당일 전체 데이터 오버라이트 유도
      if (hasGap && !alreadyClearedToday) {
        console.log(`[Cache] ${symbol} 오늘 차트 데이터 결측치(Gap) 발견! 기존 데이터 보존 하에 오늘치 강제 재수집(오버라이트) 유도.`);
        if (store[symbol]) {
          (store[symbol] as any).lastGapCleared = today; // 오늘 갭 제거 기록 (무한루프 방어)
          localStorage.setItem(CACHE_KEY, JSON.stringify(store));
        }
        // 당일 전체(09시부터) 재수집을 유도하기 위해 어제 마지막 날짜+시간을 리턴
        // 또는 오늘 09시 정각을 리턴하여 9시부터 다시 긁게 할 수 있음
        const yesterdayItems = items.filter(i => i.date !== today);
        if (yesterdayItems.length > 0) {
          const lastYesterday = yesterdayItems[yesterdayItems.length - 1];
          return lastYesterday.date + lastYesterday.hour;
        } else {
          return today + "090000"; // 어제 데이터마저 없으면 오늘 9시부터
        }
      }
    }

    // 과거 -> 현재 순 정렬 (끝이 최신)
    const last = items[items.length - 1];
    return last.date + last.hour;
  }

  /**
   * API에서 새로 가져온 데이터 목록을 기존 캐시와 병합하여 로컬 스토리지에 저장.
   * - newItems 들이 추가되거나 변경됨. 
   * - newItems: 과거->현재 순서로 정렬된 배열.
   */
  static saveMergedItems(symbol: string, newItems: ChartCacheItem[]): ChartCacheItem[] {
    const store = this.getStore();
    const today = this.getTodayString();
    
    const data = store[symbol];
    let existingItems = data?.items || [];

    // Map으로 date+hour를 키로 하여 덮어쓰거나 추가 (병합)
    const itemMap = new Map<string, ChartCacheItem>();
    
    for (const item of existingItems) {
      if (item.price > 0) itemMap.set(item.date + item.hour, item);
    }
    
    for (const item of newItems) {
      if (item.price > 0) itemMap.set(item.date + item.hour, item);
    }

    // 배열 변환 -> date+hour 오름차순(과거->최신) 정렬 -> 이후 필요시 2일치만 자르기
    const mergedItems = Array.from(itemMap.values()).sort((a, b) => 
      (a.date + a.hour).localeCompare(b.date + b.hour)
    );

    store[symbol] = {
      ...data,
      lastUpdated: today,
      items: mergedItems
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    return mergedItems;
  }
}
