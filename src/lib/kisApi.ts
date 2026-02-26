import { fetch } from '@tauri-apps/plugin-http';
import { KisAuthStorage } from './storage';
import { getMarketStatus } from './market';
import { kisRateLimiter } from './kisRateLimiter';

// KIS API Base URL (실전투자)
const KIS_API_BASE = "https://openapi.koreainvestment.com:9443";

export interface KisTickerData {
  symbol: string;
  currentPrice: number | string;
  changeRate: number | string;
  isUp: boolean;
  isDown: boolean;
  rawDetails: string[];
}

/**
 * 업종 지수(KOSPI, KOSDAQ 등)인지 확인
 */
export function isIndexSymbol(symbol: string): boolean {
  return ["0001", "1001", "2001"].includes(symbol);
}

/**
 * Access Token 발급 로직
 */
export async function getKisAccessToken(appKey: string, appSecret: string): Promise<string> {
  const auth = KisAuthStorage.get();
  if (auth) {
    const age = Date.now() - auth.tokenTime;
    if (age < 12 * 60 * 60 * 1000) return auth.accessToken;
  }

  const response = await fetch(`${KIS_API_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Access Token 발급 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  KisAuthStorage.set({ accessToken: data.access_token, tokenTime: Date.now() });
  return data.access_token;
}

/**
 * 웹소켓 승인키(Approval Key) 발급
 */
export async function getKisWsApprovalKey(appKey: string, appSecret: string): Promise<string> {
  const response = await fetch(`${KIS_API_BASE}/oauth2/Approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: appSecret, // KIS 사펙 상 웹소켓 승인은 secretkey 필드 사용
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("KIS WS Approval Error:", response.status, errorText);
    throw new Error(`WS Approval Key 발급 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.approval_key;
}

/**
 * REST API로 현재가 단건 조회 (장 전/후 또는 초기값 로드용)
 */
export async function fetchCurrentPrice(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisAccessToken(appKey, appSecret);

  const isIndex = isIndexSymbol(symbol);
  
  const url = isIndex
    ? `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-index-price?fid_cond_mrkt_div_code=U&fid_input_iscd=${symbol}`
    : `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;
    
  // FHPUP02100000 : 국내주식 업종지수 현재가
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
        "custtype": "P",
      },
    }
  ));

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`현재가 조회 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const output = data.output;

  // FHPUP02100000 의 응답 필드는 bstp_nmix_prpr, bstp_nmix_prdy_ctrt
  const currentPrice = parseFloat(isIndex ? output.bstp_nmix_prpr : output.stck_prpr) || 0;
  const changeRate = parseFloat(isIndex ? output.bstp_nmix_prdy_ctrt : output.prdy_ctrt) || 0;
  // prdy_vrss_sign: 1=상한/상승, 2=상승, 3=보합, 4=하한/하락, 5=하락
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
 * REST API로 현재가 단건 조회 (NXT 시장용)
 */
export async function fetchCurrentPriceNxt(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisAccessToken(appKey, appSecret);

  const response = await kisRateLimiter.enqueue(() => fetch(
    `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=NX&fid_input_iscd=${symbol}`,
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
    throw new Error(`NXT 현재가 조회 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const output = data.output;

  const currentPrice = parseInt(output.stck_prpr) || 0;
  const changeRate = parseFloat(output.prdy_ctrt) || 0;
  // prdy_vrss_sign: 1=상한, 2=상승, 3=보합, 4=하한, 5=하락
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
 * 시간대에 따라 정규장 또는 NXT 시세를 자동으로 조회
 */
export async function fetchCurrentPriceUnified(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const status = getMarketStatus();
  const isIndex = isIndexSymbol(symbol);

  // 업종 지수는 NXT가 없으므로 무조건 일반 조회
  if (isIndex || status === 'REGULAR') {
    return fetchCurrentPrice(appKey, appSecret, symbol);
  } else if (status === 'NXT') {
    try {
      return await fetchCurrentPriceNxt(appKey, appSecret, symbol);
    } catch (e) {
      // NXT 조회 실패 시 일반 시세로 폴백 (장 마감후 종가 등)
      return fetchCurrentPrice(appKey, appSecret, symbol);
    }
  } else {
    // 휴장 시간대에도 마지막 종가는 일반 API로 조회 가능
    return fetchCurrentPrice(appKey, appSecret, symbol);
  }
}

/**
 * 웹소켓 구독 메시지 생성
 * @param trId H0STCNT0 = KRX 실시간 체결, H0NXCNT0 = NXT 실시간 체결
 */
export function getKisWsSubscriptionMessage(approvalKey: string, symbol: string, isSubscribe: boolean = true, trId: string = "H0STCNT0"): string {
  return JSON.stringify({
    header: {
      approval_key: approvalKey,
      custtype: "P",
      tr_type: isSubscribe ? "1" : "2", // 1: 등록, 2: 해제
      "content-type": "utf-8",
    },
    body: {
      input: {
        tr_id: trId, // 일부 서버는 바디에서 tr_id 요구
        tr_key: symbol,
      },
    }
  });
}

/**
 * 실시간 체결가 데이터 파싱 (KIS 포맷 기반)
 */
export function parseTickerData(symbol: string, rawData: string, trId: string = "H0STCNT0"): KisTickerData {
  // 실제 데이터는 '데이터구분|종목코드|실제데이터' 형태로 옴
  const parts = rawData.split('|');
  if (parts.length < 4) throw new Error("Invalid WS data format");
  
  const details = parts[3].split('^');
  
  let parsedPrice = 0;
  let parsedRate = 0;
  let diffSign = "3";

  if (trId === "H0STCNI0") {
    // ==== 업종 지수 (H0STCNI0) 파싱 로직 ====
    // [0]업종코드 [1]지수일자 [2]지수시간 [3]전일대비부호 [4]전일대비 [5]전일대비율 [6]업종현재지수 [7]...
    // KIS API 공식 문서 기준: 실시간업종지수
    parsedPrice = parseFloat(details[6]); 
    parsedRate = parseFloat(details[5]);
    diffSign = details[3];
  } else {
    // ==== 개별 주식 (H0STCNT0 / H0NXCNT0) 파싱 로직 ====
    // [0]종목코드, [1]체결시간, [2]현재가, [3]전일대비부호, [4]전일대비금액, [5]전일대비율, [6]...
    parsedPrice = parseFloat(details[2]);
    parsedRate = parseFloat(details[5]);
    diffSign = details[3];
  }
  
  const currentPrice = isNaN(parsedPrice) ? (trId === "H0STCNI0" ? details[6] : details[2]) || "N/A" : parsedPrice;
  const changeRate = isNaN(parsedRate) ? details[5] || "0" : parsedRate;
  
  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: diffSign === '1' || diffSign === '2',
    isDown: diffSign === '4' || diffSign === '5',
    rawDetails: details.slice(0, 8),
  };
}

/**
 * REST API로 당일 전체 분봉 조회 (Sparkline용, 페이지네이션)
 * - KIS API는 1회 호출당 최대 30개 데이터만 반환 → 반복 호출로 전체 수집
 * @param symbol 종목코드
 */
export async function fetchIntradayChart(appKey: string, appSecret: string, symbol: string): Promise<number[]> {
  const accessToken = await getKisAccessToken(appKey, appSecret);
  const isIndex = isIndexSymbol(symbol);
  const trId = isIndex ? "FHPUP02120100" : "FHKST03010200";

  // 지수는 페이지네이션 미지원 → 단건 조회
  if (isIndex) {
    try {
      const url = `${KIS_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-time-itemchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${symbol}&FID_HOUR_CLS_CODE=1&FID_PW_DATA_INC_CLQL_CODE=N`;
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
      console.error(`Index chart fetch error for ${symbol}:`, e);
      return [];
    }
  }

  // 주식: 페이지네이션으로 당일 전체 수집 (09:00 ~ 15:30)
  const allItems: { price: number; hour: string }[] = [];
  let nextHour = "153000"; // 장 마감 기준으로 시작
  const MAX_PAGES = 14; // 최대 14회 (420분 / 30 = 14페이지)

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const url = `${KIS_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
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

      // output2는 최신→과거 순으로 반환되므로 끝이 가장 오래된 데이터
      const items = output.map((item: any) => ({
        price: parseFloat(item.stck_prpr),
        hour: item.stck_cntg_hour as string, // "HHMMSS" 형식
      }));

      allItems.push(...items);

      // 마지막 항목의 시간이 09:00 이하면 종료
      const oldestHour = items[items.length - 1].hour;
      if (oldestHour <= "090000") break;

      // 다음 페이지: 가장 오래된 시간을 기준으로 요청
      nextHour = oldestHour;

      // TPS 제한 방지: 페이지 간 200ms 대기
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      console.error(`Chart page ${page} error for ${symbol}:`, e);
      break;
    }
  }

  if (allItems.length === 0) return [];

  // 09:00 이전 데이터 제거, 오래된→최신 순으로 정렬
  const dayItems = allItems.filter(item => item.hour >= "090000");
  const sorted = dayItems.sort((a, b) => a.hour.localeCompare(b.hour));
  const prices = sorted.map(item => item.price);

  console.log(`[Chart API] ${symbol}: 전체 ${prices.length}개 수집 (${sorted[0]?.hour}~${sorted[sorted.length - 1]?.hour})`);
  return prices;
}
