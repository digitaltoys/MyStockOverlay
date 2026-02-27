/**
 * chartUtils.ts
 * 차트 렌더링을 최적화하기 위한 데이터 가공 유틸리티 모음입니다.
 */

export interface ChartPoint {
  price: number;
  date: string;
  hour: string;
}

/**
 * 1분봉 데이터의 빈 공백(Gap)을 직전 가격으로 채워넣습니다 (Forward Fill).
 * @param minuteData 1분봉 데이터 (정렬된 상태)
 * @returns 공백이 채워진 데이터
 */
export function forwardFillMinuteData(minuteData: ChartPoint[]): ChartPoint[] {
  if (minuteData.length < 2) return minuteData;

  const filled: ChartPoint[] = [];
  
  for (let i = 0; i < minuteData.length; i++) {
    const current = minuteData[i];
    if (i > 0) {
      const prev = filled[filled.length - 1];
      
      // 같은 날짜 내에서만 채움
      if (current.date === prev.date) {
        const prevMins = parseInt(prev.hour.slice(0, 2)) * 60 + parseInt(prev.hour.slice(2, 4));
        const currMins = parseInt(current.hour.slice(0, 2)) * 60 + parseInt(current.hour.slice(2, 4));
        
        // 1분 이상의 간격이 있으면 채움 (최대 60분까지만 방어적으로 채움)
        if (currMins - prevMins > 1 && currMins - prevMins <= 60) {
          for (let m = prevMins + 1; m < currMins; m++) {
            const h = String(Math.floor(m / 60)).padStart(2, '0');
            const min = String(m % 60).padStart(2, '0');
            filled.push({
              date: prev.date,
              hour: `${h}${min}00`,
              price: prev.price
            });
          }
        }
      }
    }
    filled.push(current);
  }
  
  return filled;
}

/**
 * 1분봉 데이터 배열을 10분봉 데이터 배열로 변환(Down-sampling)합니다.
 * ...
 */
export function resampleTo10Minutes(minuteData: ChartPoint[]): ChartPoint[] {
  if (!minuteData || minuteData.length === 0) return [];
  
  // 리샘플링 전 0점 필터링 및 공백 채우기 적용
  const cleanData = forwardFillMinuteData(minuteData);

  const output: ChartPoint[] = [];
  // ... (기존 루프는 cleanData 사용)
  let currentGroupPrefix = "";
  let lastPointInGroup: ChartPoint | null = null;

  for (let i = 0; i < cleanData.length; i++) {
    const item = cleanData[i];
    const groupPrefix = item.date + item.hour.substring(0, 3);

    if (currentGroupPrefix === "") {
      currentGroupPrefix = groupPrefix;
      lastPointInGroup = { ...item };
    } else if (currentGroupPrefix !== groupPrefix) {
      if (lastPointInGroup) output.push(lastPointInGroup);
      currentGroupPrefix = groupPrefix;
      lastPointInGroup = { ...item };
    } else {
      lastPointInGroup = { ...item };
    }
  }

  if (currentGroupPrefix !== "" && lastPointInGroup) {
    output.push(lastPointInGroup);
  }

  return output;
}
