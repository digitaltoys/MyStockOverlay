import type { DataSourceMode } from "../../storage";
import type { MarketDataProvider } from "../types";

export abstract class BaseProvider implements MarketDataProvider {
  abstract readonly mode: DataSourceMode;
  abstract readonly name: "KIS" | "Yahoo" | "Toss";

  abstract fetchPrice(symbol: string): Promise<import("../../types").StockData>;
  abstract fetchChart(symbol: string): Promise<import("../../types").ChartPoint[]>;
}
