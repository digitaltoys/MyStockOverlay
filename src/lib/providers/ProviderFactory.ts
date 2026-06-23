import type { AppConfig, DataSourceMode } from "../storage";
import { KisRealProvider } from "./kis/KisRealProvider";
import { KisVirtualProvider } from "./kis/KisVirtualProvider";
import { YahooProvider } from "./yahoo/YahooProvider";
import { TossProvider } from "./toss/TossProvider";
import type { MarketDataProvider } from "./types";

export function createMarketDataProvider(config: AppConfig): MarketDataProvider {
  const mode: DataSourceMode = config.dataSourceMode;
  switch (mode) {
    case "virtual":
      return new KisVirtualProvider(config);
    case "yahoo":
      return new YahooProvider(config);
    case "toss":
      return new TossProvider(config);
    case "real":
    default:
      return new KisRealProvider(config);
  }
}
