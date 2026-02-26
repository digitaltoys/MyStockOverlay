import { fetch } from '@tauri-apps/plugin-http';
import { kisRateLimiter } from './kisRateLimiter';
import { KisAuthStorage } from './storage';
import { KisTickerData, isIndexSymbol } from './kisApi';
import { getMarketStatus } from './market';

// KIS API Base URL (모의투자)
const KIS_VIRTUAL_API_BASE = "https://openapivts.koreainvestment.com:29443";

/**
 * Access Token 발급 로직 (모의투자)
 */
export async function getKisVirtualAccessToken(appKey: string, appSecret: string): Promise<string> {
  const auth = KisAuthStorage.get();
  if (auth) {
    const age = Date.now() - auth.tokenTime;
    // 토큰 저장소는 공유하되, 모드가 바뀌면 보통 새로 발급받는 것이 안전함
    // 여기서는 간단히 시간만 체크하지만, 실제로는 모드 변경 시 clear() 해주는 것이 좋음
    if (age < 12 * 60 * 60 * 1000) return auth.accessToken;
  }

  const response = await fetch(`${KIS_VIRTUAL_API_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`모의투자 Access Token 발급 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  KisAuthStorage.set({ accessToken: data.access_token, tokenTime: Date.now() });
  return data.access_token;
}

/**
 * 웹소켓 승인키(Approval Key) 발급 (모의투자)
 */
export async function getKisVirtualWsApprovalKey(appKey: string, appSecret: string): Promise<string> {
  const response = await fetch(`${KIS_VIRTUAL_API_BASE}/oauth2/Approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: appSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`모의투자 WS Approval Key 발급 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.approval_key;
}

/**
 * REST API로 현재가 단건 조회 (모의투자)
 */
export async function fetchVirtualCurrentPrice(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisVirtualAccessToken(appKey, appSecret);
  const isIndex = isIndexSymbol(symbol);
  
  const url = isIndex
    ? `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price?fid_cond_mrkt_div_code=U&fid_input_iscd=${symbol}`
    : `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;
    
  const trId = isIndex ? "FHPUP02100000" : "FHKST01010100";

  const response = await kisRateLimiter.enqueue(() => fetch(
    url,
    {
      method: "GET",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "appkey": appKey,
        "appsecret": appSecret,
        "tr_id": trId,
        "content-type": "application/json",
      },
    }
  ));

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`모의투자 현재가 조회 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const output = data.output;

  const currentPrice = parseFloat(isIndex ? output.bstp_nmix_prpr : output.stck_prpr) || 0;
  const changeRate = parseFloat(isIndex ? output.bstp_nmix_prdy_ctrt : output.prdy_ctrt) || 0;
  // 지수는 bstp_nmix_prdy_vrss_sign 필드 사용
  const sign = isIndex ? output.bstp_nmix_prdy_vrss_sign : output.prdy_vrss_sign;

  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: sign === '1' || sign === '2',
    isDown: sign === '4' || sign === '5',
    rawDetails: [],
  };
}

/**
 * REST API로 당일 전체 분봉 조회 (모의투자, Sparkline용, 페이지네이션)
 * - KIS API는 1회 호출당 최대 30개 데이터만 반환 → 반복 호출로 전체 수집
 */
export async function fetchVirtualIntradayChart(appKey: string, appSecret: string, symbol: string): Promise<number[]> {
  const accessToken = await getKisVirtualAccessToken(appKey, appSecret);
  const isIndex = isIndexSymbol(symbol);
  const trId = isIndex ? "FHPUP02120100" : "FHKST03010200";

  // 지수는 단건 조회
  if (isIndex) {
    try {
      const url = `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-time-itemchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${symbol}&FID_HOUR_CLS_CODE=1&FID_PW_DATA_INC_CLQL_CODE=N`;
      const response = await kisRateLimiter.enqueue(() => fetch(url, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appkey": appKey,
          "appsecret": appSecret,
          "tr_id": trId,
          "content-type": "application/json",
          "custtype": "P",
        },
      }));
      if (!response.ok) return [];
      const data = await response.json();
      const output = data.output2;
      if (!output || !Array.isArray(output)) return [];
      return output.map((item: any) => parseFloat(item.bstp_nmix_prpr)).reverse();
    } catch (e) {
      console.error(`Virtual Index chart fetch error for ${symbol}:`, e);
      return [];
    }
  }

  // 주식: 페이지네이션으로 당일 전체 수집 (09:00 ~ 15:30)
  const allItems: { price: number; hour: string }[] = [];
  let nextHour = "153000";
  const MAX_PAGES = 14;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const url = `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
      const response = await kisRateLimiter.enqueue(() => fetch(url, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appkey": appKey,
          "appsecret": appSecret,
          "tr_id": trId,
          "content-type": "application/json",
          "custtype": "P",
        },
      }));

      if (!response.ok) break;
      const data = await response.json();
      const output = data.output2;
      if (!output || !Array.isArray(output) || output.length === 0) break;

      const items = output.map((item: any) => ({
        price: parseFloat(item.stck_prpr),
        hour: item.stck_cntg_hour as string,
      }));

      allItems.push(...items);

      const oldestHour = items[items.length - 1].hour;
      if (oldestHour <= "090000") break;
      nextHour = oldestHour;

      // TPS 제한 방지
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      console.error(`Virtual Chart page ${page} error for ${symbol}:`, e);
      break;
    }
  }

  if (allItems.length === 0) return [];

  const dayItems = allItems.filter(item => item.hour >= "090000");
  const sorted = dayItems.sort((a, b) => a.hour.localeCompare(b.hour));
  const prices = sorted.map(item => item.price);

  console.log(`[Virtual Chart API] ${symbol}: 전체 ${prices.length}개 수집 (${sorted[0]?.hour}~${sorted[sorted.length - 1]?.hour})`);
  return prices;
}


/**
 * REST API로 현재가 단건 조회 (모의투자, NXT 시장용)
 */
export async function fetchVirtualCurrentPriceNxt(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisVirtualAccessToken(appKey, appSecret);

  const response = await kisRateLimiter.enqueue(() => fetch(
    `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=NX&fid_input_iscd=${symbol}`,
    {
      method: "GET",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "appkey": appKey,
        "appsecret": appSecret,
        "tr_id": "FHKST01010100",
        "content-type": "application/json",
      },
    }
  ));

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`모의투자 NXT 현재가 조회 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const output = data.output;

  const currentPrice = parseInt(output.stck_prpr) || 0;
  const changeRate = parseFloat(output.prdy_ctrt) || 0;
  const sign = output.prdy_vrss_sign;

  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: sign === '1' || sign === '2',
    isDown: sign === '4' || sign === '5',
    rawDetails: [],
  };
}

/**
 * 시간대에 따라 정규장 또는 NXT 시세를 자동으로 조회 (모의투자)
 */
export async function fetchVirtualCurrentPriceUnified(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const status = getMarketStatus();
  const isIndex = isIndexSymbol(symbol);

  if (isIndex || status === 'REGULAR') {
    return fetchVirtualCurrentPrice(appKey, appSecret, symbol);
  } else if (status === 'NXT') {
    try {
      return await fetchVirtualCurrentPriceNxt(appKey, appSecret, symbol);
    } catch (e) {
      return fetchVirtualCurrentPrice(appKey, appSecret, symbol);
    }
  } else {
    return fetchVirtualCurrentPrice(appKey, appSecret, symbol);
  }
}
