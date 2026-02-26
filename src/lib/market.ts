/**
 * 한국 증권 시장 시간대 및 상태 관리 유틸리티
 */

export type MarketStatus = 'REGULAR' | 'NXT' | 'CLOSED';

/**
 * 현재 한국 시간(KST)을 기준으로 시장 상태를 반환합니다.
 */
export function getMarketStatus(): MarketStatus {
  const now = new Date();
  
  // 서버 시간과 관계없이 한국 시간(UTC+9)으로 계산
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + kstOffset);
  
  const day = kstDate.getDay(); // 0: 일, 6: 토
  const hours = kstDate.getHours();
  const minutes = kstDate.getMinutes();
  const timeNum = hours * 100 + minutes; // 예: 15:30 -> 1530

  // 주말은 휴장
  if (day === 0 || day === 6) return 'CLOSED';

  // 1. NXT 프마 (Pre-market): 08:00 ~ 08:50
  if (timeNum >= 800 && timeNum < 850) return 'NXT';

  // 2. 정규장 (KRX): 09:00 ~ 15:30
  if (timeNum >= 900 && timeNum < 1530) return 'REGULAR';

  // 3. NXT 애프터 (After-market): 15:30 ~ 20:00
  // KIS API에서 15:30 이후 NXT 조회가 가능한지 확인 필요. 보통 15:40~ 등 정산 시간 제외 후 시작할 수도 있음.
  if (timeNum >= 1530 && timeNum < 2000) return 'NXT';

  return 'CLOSED';
}

/**
 * 종목코드가 업종지수인지 확인 (KIS 기준)
 */
export function isIndexSymbol(symbol: string): boolean {
  return ["0001", "1001", "2001"].includes(symbol);
}
