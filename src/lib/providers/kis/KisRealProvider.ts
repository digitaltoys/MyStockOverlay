import type { AppConfig } from "../../storage";
import { BaseKisProvider } from "../base/BaseKisProvider";

export class KisRealProvider extends BaseKisProvider {
  readonly mode = "real" as const;

  constructor(config: AppConfig) {
    super(config.apis.kis.appKey, config.apis.kis.appSecret);
  }
}
