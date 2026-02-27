import { fetch } from '@tauri-apps/plugin-http';
import { KisAuthStorage } from './storage';
import { getMarketStatus } from './market';
import { kisRateLimiter } from './kisRateLimiter';
import { ChartCacheManager } from './chartCache';
import { resampleTo10Minutes } from './chartUtils';
import { ChartPoint } from './types';

// KIS API Base URL (실전투자)
const KIS_API_BASE = "https://openapi.koreainvestment.com:9443";

// 발급 중인 토큰 프로미스 (중복 발급 방지용 락)
let tokenPromise: Promise<string> | null = null;

// 종목 타입(ETF 여부 등) 캐시 (메모리 내 유지)
export const symbolTypeCache = new Map<string, string>();

export interface KisTickerData {
  symbol: string;
  currentPrice: number | string;
  changeRate: number | string;
  isUp: boolean;
  isDown: boolean;
  basePrice?: number;
  rawDetails: string[];
}

/**
 * 업종 지수(KOSPI, KOSDAQ 등)인지 확인
 */
export function isIndexSymbol(symbol: string): boolean {
  return ["0001", "1001", "2001"].includes(symbol);
}

/**
 * 종목이 ETF/ETN인지 확인 (캐시된 타입 정보 활용)
 */
export function isEtfOrEtn(symbol: string): boolean {
  const type = symbolTypeCache.get(symbol);
  // KIS 상품유형코드: 302=ETF, 306=ETN
  return type === '302' || type === '306';
}

/**
 * Access Token 발급 로직
 */
/**
 * Access Token 발급 로직
 * @param forceRefresh true일 경우 로컬 캐시를 무시하고 무조건 재발급 받음
 */
export async function getKisAccessToken(appKey: string, appSecret: string, forceRefresh: boolean = false): Promise<string> {
  // 1. 이미 진행 중인 발급 작업이 있으면 그 결과를 기다림
  if (tokenPromise) return tokenPromise;

  const auth = KisAuthStorage.get(false);
  if (!forceRefresh && auth) {
    const age = Date.now() - auth.tokenTime;
    // 12시간 제한
    if (age < 12 * 60 * 60 * 1000) return auth.accessToken;
  }

  // 2. 새로운 발급 작업 시작 (Lock 설정)
  tokenPromise = (async () => {
    try {
      const response = await kisRateLimiter.enqueue(() => fetch(`${KIS_API_BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
      }));

      const data = await response.json();

      if (!response.ok) {
        // 분당 1회 제한(EGW00133)인 경우, 누군가 이미 발급했을 수 있으므로 캐시가 있다면 리턴
        if (data.error_code === "EGW00133") {
          const retryAuth = KisAuthStorage.get(false);
          if (retryAuth) {
            console.log("[Token] EGW00133 hit, reusing existing token in storage.");
            return retryAuth.accessToken;
          }
        }
        throw new Error(`Access Token 발급 실패: ${response.status} ${JSON.stringify(data)}`);
      }

      KisAuthStorage.set({ accessToken: data.access_token, tokenTime: Date.now() }, false);
      return data.access_token;
    } finally {
      // 작업 완료 후 락 해제
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

/**
 * 웹소켓 승인키(Approval Key) 발급
 */
export async function getKisWsApprovalKey(appKey: string, appSecret: string): Promise<string> {
  const response = await kisRateLimiter.enqueue(() => fetch(`${KIS_API_BASE}/oauth2/Approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: appSecret, // KIS 사펙 상 웹소켓 승인은 secretkey 필드 사용
    }),
  }));

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

  const data = await response.json();

  // 토큰 만료 에러 (EGW00123) 시 강제 재발급 및 재시도 (1회 한정)
  if (!response.ok && data.msg_cd === "EGW00123") {
    console.log(`[Token Expired] fetchCurrentPrice(${symbol}) EGW00123 감지, 토큰 강제 갱신 및 재시도 중...`);
    await getKisAccessToken(appKey, appSecret, true);
    return fetchCurrentPrice(appKey, appSecret, symbol);
  }

  if (!response.ok) {
    throw new Error(`현재가 조회 실패: ${response.status} ${JSON.stringify(data)}`);
  }

  const output = data.output;
  
  // 종목 타입 캐싱 (있을 경우)
  if (!isIndex && output.prdt_type_cd) {
    symbolTypeCache.set(symbol, output.prdt_type_cd);
  }

  // FHPUP02100000 의 응답 필드는 bstp_nmix_prpr, bstp_nmix_prdy_ctrt
  const currentPrice = parseFloat(isIndex ? output.bstp_nmix_prpr : output.stck_prpr) || 0;
  const changeRate = parseFloat(isIndex ? output.bstp_nmix_prdy_ctrt : output.prdy_ctrt) || 0;
  // prdy_vrss_sign: 1=상한/상승, 2=상승, 3=보합, 4=하한/하락, 5=하락
  // sign은 isUp/isDown 판단용으로만 활용
  const sign = isIndex ? output.bstp_nmix_prdy_vrss_sign : output.prdy_vrss_sign;
  
  // KIS API에서 제공하는 전일 종가(기준가) 필드 직접 사용
  const basePrice = parseFloat(isIndex ? output.bstp_nmix_prdy_clpr : output.stck_sdpr) || 0;

  // 기준가 캐시 업데이트
  ChartCacheManager.updateBasePrice(symbol, basePrice);

  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: sign === '1' || sign === '2',
    isDown: sign === '4' || sign === '5',
    basePrice,
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

  const data = await response.json();

  // 토큰 만료 에러 (EGW00123) 시 강제 재발급 및 재시도
  if (!response.ok && data.msg_cd === "EGW00123") {
    console.log(`[Token Expired] fetchCurrentPriceNxt(${symbol}) EGW00123 감지, 토큰 강제 갱신 중...`);
    await getKisAccessToken(appKey, appSecret, true);
    return fetchCurrentPriceNxt(appKey, appSecret, symbol);
  }

  if (!response.ok) {
    throw new Error(`NXT 현재가 조회 실패: ${response.status} ${JSON.stringify(data)}`);
  }
  const output = data.output;
  if (!output || !output.stck_prpr || output.stck_prpr === "0") {
    throw new Error(`NXT 현재가 데이터 부재 (${symbol})`);
  }

  const currentPrice = parseFloat(output.stck_prpr) || 0;
  const changeRate = parseFloat(output.prdy_ctrt) || 0;
  // prdy_vrss_sign: 1=상한, 2=상승, 3=보합, 4=하한, 5=하락
  const sign = output.prdy_vrss_sign;

  // KIS API에서 제공하는 전일 종가(기준가) 필드 직접 사용
  const basePrice = parseFloat(output.stck_sdpr) || 0;

  // 기준가 캐시 업데이트
  ChartCacheManager.updateBasePrice(symbol, basePrice);

  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: sign === '1' || sign === '2',
    isDown: sign === '4' || sign === '5',
    basePrice,
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
  
  const diffAmt = parseFloat(details[4]) || 0;
  let basePrice = typeof currentPrice === 'number' ? currentPrice : 0;
  if (basePrice > 0) {
    if (diffSign === '1' || diffSign === '2') basePrice -= diffAmt;
    else if (diffSign === '4' || diffSign === '5') basePrice += diffAmt;
  }
  
  console.log(`[KIS WS] ${symbol} Price: ${currentPrice}, Base: ${basePrice} (Sign: ${diffSign})`);

  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: diffSign === '1' || diffSign === '2',
    isDown: diffSign === '4' || diffSign === '5',
    basePrice: basePrice > 0 ? basePrice : undefined,
    rawDetails: details.slice(0, 8),
  };
}

/**
 * REST API로 당일 전체 분봉 조회 (Sparkline용, 페이지네이션)
 * - KIS API는 1회 호출당 최대 30개 데이터만 반환 → 반복 호출로 전체 수집
 * @param symbol 종목코드
 */
export async function fetchIntradayChart(appKey: string, appSecret: string, symbol: string): Promise<ChartPoint[]> {
  let accessToken = await getKisAccessToken(appKey, appSecret);
  const isIndex = isIndexSymbol(symbol);
  const trId = isIndex ? "FHKUP03500200" : "FHKST03010200";

  // 지수는 페이지네이션 미지원 → 단건 조회 시 더 넓은 범위를 가져오기 위해 1분(1) 대신 5분(5) 단위로 시도 가능하나,
  // 캐시를 사용하면 1분 단위로 차곡차곡 쌓을 수 있으므로 1분(1) 유지가 데이터 정밀도 면에서 유리함.
  if (isIndex) {
    try {
      const url = `${KIS_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=60&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=0`;
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
      if (!response.ok) {
        console.error(`[KIS API] Index chart response not OK: ${response.status}`);
        return [];
      }
      const data = await response.json();
      const output = data.output2;
      
      console.log(`[KIS API] ${symbol} Index Chart Response:`, { 
        rt_cd: data.rt_cd, 
        msg: data.msg1, 
        outputCount: output?.length 
      });

      if (!output || !Array.isArray(output)) return [];
      
      const newItems = output
        .filter((item: any) => {
          const h = item.stck_cntg_hour;
          // 장 종료 후에도 데이터를 볼 수 있도록 범위를 18시까지로 확장
          return h >= "080000" && h <= "180000";
        })
        .map((item: any) => ({
          price: parseFloat(item.bstp_nmix_prpr),
          date: item.stck_bsop_date as string,
          hour: item.stck_cntg_hour as string
        }));

      console.log(`[KIS API] ${symbol} New Items Count: ${newItems.length}`);

      // [개선] 지수 데이터도 로컬 캐시에 병합하여 데이터 누적
      const mergedItems = ChartCacheManager.saveMergedItems(symbol, newItems.sort((a, b) => 
        (a.date + a.hour).localeCompare(b.date + b.hour)
      ));
      
      console.log(`[KIS API] ${symbol} Merged Items Count: ${mergedItems.length}`);
      
      return resampleTo10Minutes(mergedItems);
    } catch (e) {
      console.error(`Index chart fetch error for ${symbol}:`, e);
      return [];
    }
  }

  // 주식: 당일과 전일 2일치 분봉을 모두 수집. (최대 14페이지 * 2 = 넉넉하게 20페이지)
  const cachedDateHour = ChartCacheManager.getLastCachedDateHour(symbol);
  const targetDateHour = cachedDateHour || "00000000000000";

  const allItems: { price: number; date: string; hour: string }[] = [];
  
  const now = new Date();
  const todayYYYYMMDD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  
  // 현재 시각부터 과거로 역추적 시작 (장마감 이후면 180000 상한선)
  let nextHour = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}00`;
  if (nextHour > "180000") nextHour = "180000";

  const LIMIT_HOUR = "080000"; 
  const MAX_PAGES = 30; // 무한루프(헛돎) 방어 가드
  
  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      // 거꾸로 흘러가는 시간에 맞춰 시장(Market) 코드를 동적으로 스위칭
      let market = "J";
      if (nextHour > "153000" && nextHour <= "180000") {
        market = "NX"; // 오후 장후
      } else if (nextHour < "090000") {
        market = "NX"; // 오전 장전
      } else {
        market = "J";  // 정규장
      }

      // [최적화] 지수나 ETF는 야간(NX) 조회가 무의미하므로 정규 시간 외에는 건너뛰거나 J로 강제 전환
      if (market === "NX" && (isIndex || isEtfOrEtn(symbol))) {
        if (nextHour > "153000") {
          nextHour = "153000"; // 정규장 마감 시각으로 점프
          continue;
        } else {
          break; // 오전 장전은 무시
        }
      }

      const url = `${KIS_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=${market}&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
      let response = await kisRateLimiter.enqueue(() => fetch(url, {
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

      let data = await response.json();

      // 토큰 만료 에러 감지 시 갱신 후 재시도
      if (!response.ok && data.msg_cd === "EGW00123") {
        console.log(`[Token Expired] fetchIntradayChart(${symbol}) EGW00123 감지, 갱신 중...`);
        accessToken = await getKisAccessToken(appKey, appSecret, true);
        page--; continue;
      }

      if (!response.ok) break;

      let output = data.output2;

      // [0점 필터링] 유효한 가격(>0)만 추출
      let validItems = (output && Array.isArray(output)) 
        ? output
            .filter((item: any) => {
              const p = parseFloat(item.stck_prpr);
              return p > 0 && item.stck_cntg_hour >= "080000" && item.stck_cntg_hour <= "180000";
            })
            .map((item: any) => ({
              price: parseFloat(item.stck_prpr),
              date: item.stck_bsop_date as string,
              hour: item.stck_cntg_hour as string,
            }))
        : [];

      // [ETF 폴백 처리] NX 시장에서 유효 데이터가 없으면 정규장(J) 시장으로 한번 더 찔러봄
      if (market === "NX" && validItems.length === 0) {
        console.log(`[Chart API] ${symbol} NX valid data empty, retrying with Regular(J) market...`);
        const fallbackUrl = `${KIS_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
        const fbResponse = await kisRateLimiter.enqueue(() => fetch(fallbackUrl, {
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
        if (fbResponse.ok) {
          const fbData = await fbResponse.json();
          const fbOutput = fbData.output2;
          if (fbOutput && Array.isArray(fbOutput)) {
            validItems = fbOutput
              .filter((item: any) => {
                const p = parseFloat(item.stck_prpr);
                return p > 0 && item.stck_cntg_hour >= "080000" && item.stck_cntg_hour <= "180000";
              })
              .map((item: any) => ({
                price: parseFloat(item.stck_prpr),
                date: item.stck_bsop_date as string,
                hour: item.stck_cntg_hour as string,
              }));
          }
        }
      }

      if (validItems.length === 0) break;

      allItems.push(...validItems);

      // 다음 페이지 조회를 위한 oldest 정보는 API 원본(output)에서 가져옴
      const oldestRawItem = output[output.length - 1];
      const oldestDateHour = oldestRawItem.stck_bsop_date + oldestRawItem.stck_cntg_hour;
      const oldestHour = oldestRawItem.stck_cntg_hour;

      // 1. 이미 캐시된 데이터 영역에 도달하면 중단
      if (oldestDateHour <= targetDateHour) break;
      // 2. 과거로 가다가 오늘 아침 8시 바깥(어제 날짜나 08시 돌파)으로 넘어가면 중단
      if (oldestRawItem.stck_bsop_date !== todayYYYYMMDD || oldestHour < LIMIT_HOUR) break;
      // 3. 서버에 더 이상 과거 데이터가 없어서 똑같은 시간이 오면 중단
      if (oldestHour === nextHour) {
        console.log(`[Chart API] ${symbol} 데이터 바닥 도달. 08시 역추적 조기 종료.`);
        break;
      }

      nextHour = oldestHour; // 다음 루프는 이 시점부터 과거 방향으로
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      console.error(`Chart API fetch error for ${symbol}:`, e);
      break;
    }
  }

  if (allItems.length === 0) return [];

  // 중복된 시간대(boundary hour)를 Map 자료구조로 제거
  const uniqueMap = new Map<string, { price: number; date: string; hour: string }>();
  for (const item of allItems) {
    uniqueMap.set(item.date + item.hour, item);
  }

  const newItems = Array.from(uniqueMap.values());
  // date + hour 기준으로 완벽하게 시간순 오름차순 정렬
  const sortedNewItems = newItems.sort((a, b) => 
    (a.date + a.hour).localeCompare(b.date + b.hour)
  );
  
  // 기존 캐시와 병합하여 로컬 스토리지 업데이트 및 전체 리스트 반환
  const mergedItems = ChartCacheManager.saveMergedItems(symbol, sortedNewItems);

  let dateRange = "";
  if (sortedNewItems.length > 0) {
    const first = sortedNewItems[0];
    const last = sortedNewItems[sortedNewItems.length - 1];
    dateRange = ` [${first.date} ${first.hour} ~ ${last.date} ${last.hour}]`;
  }

  console.log(`[Chart API] ${symbol}: ${newItems.length}개 추가로 수집${dateRange}, 총 ${mergedItems.length}개 (1분봉) 병합 완료`);
  
  // 1분봉 배열을 10분봉으로 대표값 추출 (Down-sampling)
  return resampleTo10Minutes(mergedItems);
}
