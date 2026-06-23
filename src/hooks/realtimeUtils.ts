import { invoke } from "@tauri-apps/api/core";
import type { ChartPoint, StockData } from "../lib/types";

export function appendRealtimeChartPoint(
  chart: ChartPoint[],
  point: ChartPoint,
): ChartPoint[] {
  const nextChart = [...chart];
  if (nextChart.length === 0) return [point];

  const lastPoint = nextChart[nextChart.length - 1];
  const lastGroup = `${lastPoint.date}${lastPoint.hour.substring(0, 3)}`;
  const nextGroup = `${point.date}${point.hour.substring(0, 3)}`;

  if (lastGroup === nextGroup) {
    nextChart[nextChart.length - 1] = point;
  } else {
    nextChart.push(point);
  }

  if (nextChart.length > 400) return nextChart.slice(-400);
  return nextChart;
}

export function makeCurrentChartPoint(price: number): ChartPoint {
  const now = new Date();
  return {
    price,
    date: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    hour: `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`,
  };
}

export function broadcastTickerData(symbol: string, data: StockData) {
  return invoke("broadcast_ticker_data", { symbol, data });
}
