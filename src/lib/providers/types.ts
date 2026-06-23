import type { DataSourceMode } from "../storage";
import type { ChartPoint, StockData } from "../types";

export interface MarketDataProvider {
  readonly mode: DataSourceMode;
  readonly name: "KIS" | "Yahoo" | "Toss";
  fetchPrice(symbol: string): Promise<StockData>;
  fetchChart(symbol: string): Promise<ChartPoint[]>;
}
