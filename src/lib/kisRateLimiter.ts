/**
 * kisRateLimiter.ts
 * KIS API REST 호출을 직렬화하여 TPS(초당 거래건수) 초과를 방지합니다.
 *
 * - 모의투자: 최소 600ms 간격 (안전하게 초당 1.6건 이하)
 * - 실전투자: 최소 100ms 간격 (초당 10건 이하, 공식 20건 절반으로 여유)
 */

type QueueTask<T> = () => Promise<T>;

class KisRateLimiter {
  private queue: Array<{ task: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];
  private isRunning = false;
  private minIntervalMs: number;

  constructor(minIntervalMs = 600) {
    this.minIntervalMs = minIntervalMs;
  }

  /** TPS 간격 업데이트 (실전/모의투자 모드 전환 시 호출) */
  setInterval(ms: number) {
    this.minIntervalMs = ms;
  }

  /** API 호출을 큐에 추가하고 결과를 Promise로 반환 */
  enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.isRunning) this.processQueue();
    });
  }

  private async processQueue() {
    this.isRunning = true;
    while (this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift()!;
      try {
        const result = await task();
        resolve(result);
      } catch (e) {
        reject(e);
      }
      // 다음 호출 전 최소 간격 대기
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.minIntervalMs));
      }
    }
    this.isRunning = false;
  }
}

// 전역 싱글턴 인스턴스 (모의투자 기본값: 600ms)
export const kisRateLimiter = new KisRateLimiter(600);
