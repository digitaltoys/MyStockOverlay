import type { AppConfig } from "../../storage";
import { BaseKisProvider } from "../base/BaseKisProvider";

export class KisVirtualProvider extends BaseKisProvider {
  readonly mode = "virtual" as const;

  constructor(config: AppConfig) {
    super(config.apis.kisVirtual.appKey, config.apis.kisVirtual.appSecret);
  }
}
