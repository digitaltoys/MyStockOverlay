import React, { useMemo, useId } from 'react';
import { ChartPoint } from '../lib/types';

interface SparklineProps {
  data: number[] | ChartPoint[];
  basePrice?: number; // 전일 종가 (강제 기준선 용도)
  width?: number;
  height?: number;
}

const Sparkline: React.FC<SparklineProps> = ({
  data,
  basePrice,
  width = 100,
  height = 30
}) => {
  const id = useId();

  const { yesterdayPoints, todayPoints, splitX, baselinePercent } = useMemo(() => {
    if (!data || data.length < 2) return { yesterdayPoints: "", todayPoints: "", splitX: -1, baselinePercent: 0 };

    const isComplex = typeof data[0] === 'object';
    const prices = isComplex
      ? (data as ChartPoint[]).map(d => d.price)
      : (data as number[]);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1; // 0으로 나누기 방지

    // 날짜 구분선(splitIndex) 찾기
    let foundSplitIndex = -1;
    if (isComplex) {
      const complexData = data as ChartPoint[];
      const today = complexData[complexData.length - 1].date;
      for (let i = 0; i < complexData.length; i++) {
        if (complexData[i].date === today) {
          foundSplitIndex = i;
          break;
        }
      }
    }

    // 명시적인 전일 종가(basePrice)가 있으면 최우선으로, 없으면 어제 마지막 데이터, 그것도 없으면 시가를 기준점으로 삼음
    const baselinePrice = basePrice !== undefined
      ? basePrice
      : (foundSplitIndex > 0 ? prices[foundSplitIndex - 1] : prices[0]);

    const computedBaselineY = height - ((baselinePrice - min) / range) * height;
    const computedBaselinePercent = Math.max(0, Math.min(100, (computedBaselineY / height) * 100));

    let yesterdayPointsStr = "";
    let todayPointsStr = "";
    let complexData: ChartPoint[] | null = null;
    if (isComplex) complexData = data as ChartPoint[];

    const getTimeRatio = (hourStr: string) => {
      const h = parseInt(hourStr.slice(0, 2));
      const m = parseInt(hourStr.slice(2, 4));
      let mins = h * 60 + m;
      // 08:30(510) ~ 18:00(1080) 전체 570분 스팬
      if (mins < 510) mins = 510;
      if (mins > 1080) mins = 1080;
      return (mins - 510) / 570;
    };

    if (foundSplitIndex > 0) {
      yesterdayPointsStr = prices.slice(0, foundSplitIndex + 1).map((val, i) => {
        let x = (i / (prices.length - 1)) * width;
        if (isComplex && complexData) {
          if (i === foundSplitIndex) {
            // 스플릿 포인트는 오늘 배열 좌표로 연장하여 어제 선과 매끄럽게 연결
            x = (width / 2) + getTimeRatio(complexData[i].hour) * (width / 2);
          } else {
            // 어제 데이터는 화면의 왼쪽 절반(0% ~ 50%)
            x = getTimeRatio(complexData[i].hour) * (width / 2);
          }
        }
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
      }).join(" ");

      todayPointsStr = prices.slice(foundSplitIndex).map((val, i) => {
        const actualIndex = i + foundSplitIndex;
        let x = (actualIndex / (prices.length - 1)) * width;
        if (isComplex && complexData) {
          // 오늘 데이터는 화면의 오른쪽 절반(50% ~ 100%)
          x = (width / 2) + getTimeRatio(complexData[actualIndex].hour) * (width / 2);
        }
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
      }).join(" ");
    } else {
      todayPointsStr = prices.map((val, i) => {
        let x = (i / (prices.length - 1)) * width;
        if (isComplex && complexData) {
          x = getTimeRatio(complexData[i].hour) * width;
        }
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
      }).join(" ");
    }

    // 날짜 구분선 X (어제와 오늘의 경계)
    const finalSplitX = foundSplitIndex > 0
      ? (isComplex ? width / 2 : (foundSplitIndex / (prices.length - 1)) * width)
      : -1;

    return {
      yesterdayPoints: yesterdayPointsStr,
      todayPoints: todayPointsStr,
      splitX: finalSplitX,
      baselinePercent: computedBaselinePercent
    };
  }, [data, width, height]);

  if (!data || data.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <div className="w-full h-[1px] bg-white/10" />
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-y-${id}`} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset={`${baselinePercent}%`} stopColor="#ef4444" />
          <stop offset={`${baselinePercent}%`} stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {splitX > 0 && (
        <line
          x1={splitX}
          y1={0}
          x2={splitX}
          y2={height}
          stroke="#888888"
          strokeWidth="1"
          strokeDasharray="2,2"
          opacity="0.5"
        />
      )}

      {yesterdayPoints && (
        <polyline
          fill="none"
          stroke="#888888"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
          points={yesterdayPoints}
        />
      )}

      <polyline
        fill="none"
        stroke={`url(#grad-y-${id})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={todayPoints}
      />
    </svg>
  );
};

export default Sparkline;
