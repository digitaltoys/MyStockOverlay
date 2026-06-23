import { fetchCurrentPriceUnified, fetchIntradayChart } from "../../kisApi";
import { fetchVirtualCurrentPriceUnified, fetchVirtualIntradayChart } from "../../kisVirtualApi";
import type { ChartPoint, StockData } from "../../types";
import { BaseProvider } from "./BaseProvider";

export abstract class BaseKisProvider extends BaseProvider {
  abstract readonly mode: "real" | "virtual";
  readonly name = "KIS" as const;

  protected constructor(
    protected readonly appKey: string,
    protected readonly appSecret: string,
  ) {
    super();
  }

  async fetchPrice(symbol: string): Promise<StockData> {
    const result = this.mode === "virtual"
      ? await fetchVirtualCurrentPriceUnified(this.appKey, this.appSecret, symbol)
      : await fetchCurrentPriceUnified(this.appKey, this.appSecret, symbol);

    return {
      symbol: result.symbol,
      currentPrice: result.currentPrice,
      changeRate: result.changeRate,
      isUp: result.isUp,
      isDown: result.isDown,
      basePrice: result.basePrice,
      dataSource: "KIS",
      updatedAt: Date.now(),
      intradayPrices: undefined,
    };
  }

  async fetchChart(symbol: string): Promise<ChartPoint[]> {
    return this.mode === "virtual"
      ? fetchVirtualIntradayChart(this.appKey, this.appSecret, symbol)
      : fetchIntradayChart(this.appKey, this.appSecret, symbol);
  }
}
