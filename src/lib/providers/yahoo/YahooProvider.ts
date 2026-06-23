import type { AppConfig } from "../../storage";
import { fetchFallbackData } from "../../fallbackApi";
import type { ChartPoint, StockData } from "../../types";
import { BaseProvider } from "../base/BaseProvider";

export class YahooProvider extends BaseProvider {
  readonly mode = "yahoo" as const;
  readonly name = "Yahoo" as const;

  constructor(_config: AppConfig) {
    super();
  }

  async fetchPrice(symbol: string): Promise<StockData> {
    return fetchFallbackData(symbol);
  }

  async fetchChart(symbol: string): Promise<ChartPoint[]> {
    const data = await fetchFallbackData(symbol);
    return (data.intradayPrices || []) as ChartPoint[];
  }
}
