import { fetchCurrentPriceUnified, fetchIntradayChart, KisTickerData } from '../kisApi';
import * as kisVirtualApi from '../kisVirtualApi';
import { ChartPoint } from '../types';

/**
 * KisDataManager
 * - 역할: 동일한 종목(symbol)과 API 종류에 대해 여러 곳에서 동시다발적으로 요청할 경우,
 *        1번만 실제 네트워크 요청을 보내고 나머지 요청자들은 캐싱된 Promise를 대기(Share)하여 반환받게 합니다.
 * - 단일 책임 원칙 (SRP) 준수
 */
class KisDataManager {
  private pricePromises: Map<string, Promise<KisTickerData>> = new Map();
  private chartPromises: Map<string, Promise<ChartPoint[]>> = new Map();

  /**
   * 단건 현재가 조회 (중복 방지)
   */
  public async fetchPrice(
    appKey: string,
    appSecret: string,
    symbol: string,
    isVirtual: boolean
  ): Promise<KisTickerData> {
    const cacheKey = `${isVirtual ? 'v_' : 'r_'}${symbol}`;
    
    // 이미 진행 중인 요청이 있다면 그 Promise를 그대로 반환 (공유)
    if (this.pricePromises.has(cacheKey)) {
      console.log(`[KisDataManager] Price request for ${symbol} is already in progress. Returning cached promise.`);
      return this.pricePromises.get(cacheKey)!;
    }

    console.log(`[KisDataManager] Initiating new Price request for ${symbol} (Virtual: ${isVirtual})`);
    const fetchFunc = isVirtual ? kisVirtualApi.fetchVirtualCurrentPriceUnified : fetchCurrentPriceUnified;
    
    // 새 요청 생성 및 Promise 캐싱
    const promise = fetchFunc(appKey, appSecret, symbol)
      .then(data => {
        this.pricePromises.delete(cacheKey); // 성공 시 캐시 제거
        return data;
      })
      .catch(error => {
        this.pricePromises.delete(cacheKey); // 실패 시에도 캐시 제거 (다음엔 재시도할 수 있게)
        console.error(`[KisDataManager] fetchPrice Failed for ${symbol} (Virtual: ${isVirtual}):`, error);
        throw error;
      });

    this.pricePromises.set(cacheKey, promise);
    return promise;
  }

  /**
   * 당일 차트 분봉 전체 조회 (중복 방지)
   */
  public async fetchChart(
    appKey: string,
    appSecret: string,
    symbol: string,
    isVirtual: boolean
  ): Promise<ChartPoint[]> {
    const cacheKey = `${isVirtual ? 'v_' : 'r_'}${symbol}`;
    
    // 이미 진행 중인 차트 조회 요청이 있다면 대기 및 공유
    if (this.chartPromises.has(cacheKey)) {
      console.log(`[KisDataManager] Chart request for ${symbol} is already in progress. Returning cached promise.`);
      return this.chartPromises.get(cacheKey)!;
    }

    console.log(`[KisDataManager] Initiating new Chart request for ${symbol} (Virtual: ${isVirtual})`);
    const fetchChartFunc = isVirtual ? kisVirtualApi.fetchVirtualIntradayChart : fetchIntradayChart;
    
    // 새 요청 생성 및 Promise 캐싱
    const promise = fetchChartFunc(appKey, appSecret, symbol)
      .then(data => {
        this.chartPromises.delete(cacheKey);
        return data;
      })
      .catch(error => {
        this.chartPromises.delete(cacheKey);
        console.error(`[KisDataManager] fetchChart Failed for ${symbol} (Virtual: ${isVirtual}):`, error);
        // 장애 시 빈 배열이라도 던져서 앱이 뻗는 현상 방지. 부분 데이터 복구는 API 내부 catch에서 함.
        return [] as ChartPoint[]; 
      });

    this.chartPromises.set(cacheKey, promise);
    return promise;
  }
}

// 싱글톤 인스턴스 내보내기
export const kisDataManager = new KisDataManager();
