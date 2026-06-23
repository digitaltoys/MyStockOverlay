import { kisRateLimiter } from './kisRateLimiter';
import { ChartCacheManager } from './chartCache';
import { resampleTo10Minutes } from './chartUtils';
import { KisAuthStorage } from './storage';
import { KisTickerData, isIndexSymbol, symbolTypeCache, isEtfOrEtn, kisFetch } from './kisApi';
import { getMarketStatus } from './market';
import { ChartPoint } from './types';

// KIS API Base URL (모의투자)
const KIS_VIRTUAL_API_BASE = "https://openapivts.koreainvestment.com:29443";

// 발급 중인 토큰 프로미스 (중복 발급 방지용 락)
let virtualTokenPromise: Promise<string> | null = null;

/**
 * Access Token 발급 로직 (모의투자)
 * @param forceRefresh true일 경우 로컬 캐시를 무시하고 무조건 재발급 받음
 */
export async function getKisVirtualAccessToken(appKey: string, appSecret: string, forceRefresh: boolean = false): Promise<string> {
  // 1. 이미 진행 중인 발급 작업이 있으면 그 결과를 기다림
  if (virtualTokenPromise) return virtualTokenPromise;

  const auth = KisAuthStorage.get(true);
  if (!forceRefresh && auth) {
    const age = Date.now() - auth.tokenTime;
    // 토큰 저장소는 공유하되, 모드가 바뀌면 보통 새로 발급받는 것이 안전함
    if (age < 12 * 60 * 60 * 1000) return auth.accessToken;
  }

  // 2. 새로운 발급 작업 시작 (Lock 설정)
  virtualTokenPromise = (async () => {
    try {
      const data = await kisRateLimiter.enqueue(() => kisFetch(`${KIS_VIRTUAL_API_BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://openapivts.koreainvestment.com:29443",
          "Referer": "https://openapivts.koreainvestment.com:29443/"
        },
        body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
      }));

      KisAuthStorage.set({ accessToken: data.access_token, tokenTime: Date.now() }, true);
      return data.access_token;
    } catch (err: any) {
      if (err.message && err.message.includes("EGW00133")) {
        const retryAuth = KisAuthStorage.get(true);
        if (retryAuth) {
          console.log("[Virtual Token] EGW00133 hit, reusing existing token in storage.");
          return retryAuth.accessToken;
        }
      }
      console.error(`[Virtual KisApi][Token] Fetch Failed.`, err);
      throw err;
    } finally {
      // 작업 완료 후 락 해제
      virtualTokenPromise = null;
    }
  })();

  return virtualTokenPromise;
}

/**
 * 웹소켓 승인키(Approval Key) 발급 (모의투자)
 */
export async function getKisVirtualWsApprovalKey(appKey: string, appSecret: string): Promise<string> {
  const data = await kisRateLimiter.enqueue(() => kisFetch(`${KIS_VIRTUAL_API_BASE}/oauth2/Approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://openapivts.koreainvestment.com:29443",
      "Referer": "https://openapivts.koreainvestment.com:29443/"
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: appSecret,
    }),
  }));

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

  let data;
  try {
    data = await kisRateLimiter.enqueue(() => kisFetch(
      url,
      {
        method: "GET",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appkey": appKey,
          "appsecret": appSecret,
          "tr_id": trId,
          "content-type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://openapivts.koreainvestment.com:29443",
          "Referer": "https://openapivts.koreainvestment.com:29443/"
        },
      }
    ));
  } catch (error: any) {
    if (error.message && error.message.includes("EGW00123")) {
      console.log(`[Token Expired] fetchVirtualCurrentPrice(${symbol}) EGW00123 감지, 토큰 갱신 중...`);
      await getKisVirtualAccessToken(appKey, appSecret, true);
      return fetchVirtualCurrentPrice(appKey, appSecret, symbol);
    }
    throw new Error(`모의투자 현재가 조회 실패: ${error.message}`);
  }

  if (data.rt_cd !== '0') {
    throw new Error(`모의투자 현재가 조회 실패: ${data.msg1}`);
  }
  const output = data.output;

  // 종목 타입 캐싱 (있을 경우)
  if (!isIndex && output.prdt_type_cd) {
    symbolTypeCache.set(symbol, output.prdt_type_cd);
  }

  const currentPrice = parseFloat(isIndex ? output.bstp_nmix_prpr : output.stck_prpr) || 0;
  const changeRate = parseFloat(isIndex ? output.bstp_nmix_prdy_ctrt : output.prdy_ctrt) || 0;
  // 지수는 bstp_nmix_prdy_vrss_sign 필드 사용
  const sign = isIndex ? output.bstp_nmix_prdy_vrss_sign : output.prdy_vrss_sign;

  // KIS API에서 제공하는 전일 종가(기준가) 필드 직접 사용
  const basePrice = parseFloat(isIndex ? output.bstp_nmix_prdy_clpr : output.stck_sdpr) || 0;

  // 기준가 캐시 업데이트
  ChartCacheManager.updateBasePrice(symbol, basePrice);

  return {
    symbol,
    displayName: isIndex
      ? output.bstp_nmix_kor_isnm ?? output.hts_kor_isnm ?? symbol
      : output.hts_kor_isnm ?? output.pdno ?? output.stck_shrn_iscd ?? symbol,
    currentPrice,
    changeRate,
    isUp: sign === '1' || sign === '2',
    isDown: sign === '4' || sign === '5',
    basePrice,
    rawDetails: [],
  };
}

/**
 * REST API로 당일 전체 분봉 조회 (모의투자, Sparkline용, 페이지네이션)
 * - KIS API는 1회 호출당 최대 30개 데이터만 반환 → 반복 호출로 전체 수집
 */
export async function fetchVirtualIntradayChart(appKey: string, appSecret: string, symbol: string): Promise<ChartPoint[]> {
  let accessToken = await getKisVirtualAccessToken(appKey, appSecret);
  const isIndex = isIndexSymbol(symbol);
  const trId = isIndex ? "FHKUP03500200" : "FHKST03010200";

  // 지수는 단건 조회
  if (isIndex) {
    try {
      const url = `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=60&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=0`;
      const data = await kisRateLimiter.enqueue(() => kisFetch(url, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appkey": appKey,
          "appsecret": appSecret,
          "tr_id": trId,
          "content-type": "application/json",
          "custtype": "P",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://openapivts.koreainvestment.com:29443",
          "Referer": "https://openapivts.koreainvestment.com:29443/"
        },
      }));
      if (data.rt_cd !== '0') {
        console.error(`[Virtual KIS API] Index chart response not OK: ${data.msg1}`);
        return [];
      }
      const output = data.output2;
      
      console.log(`[Virtual KIS API] ${symbol} Index Chart Response:`, { 
        rt_cd: data.rt_cd, 
        msg: data.msg1, 
        outputCount: output?.length 
      });

      if (!output || !Array.isArray(output)) return [];
      
      const newItems = output
        .filter((item: any) => {
          const h = item.stck_cntg_hour;
          return h >= "080000" && h <= "180000";
        })
        .map((item: any) => ({
          price: parseFloat(item.bstp_nmix_prpr),
          date: item.stck_bsop_date as string,
          hour: item.stck_cntg_hour as string
        }));

      console.log(`[Virtual KIS API] ${symbol} New Items Count: ${newItems.length}`);

      // [개선] 지수 데이터도 로컬 캐시에 병합하여 데이터 누적
      const mergedItems = ChartCacheManager.saveMergedItems(symbol, newItems.sort((a, b) => 
        (a.date + a.hour).localeCompare(b.date + b.hour)
      ));
      
      console.log(`[Virtual KIS API] ${symbol} Merged Items Count: ${mergedItems.length}`);
      
      return resampleTo10Minutes(mergedItems);
    } catch (e) {
      console.error(`Virtual Index chart fetch error for ${symbol}:`, e);
      return [];
    }
  }

  // 주식: 당일과 전일 2일치 분봉을 모두 수집.
  const cachedDateHour = ChartCacheManager.getLastCachedDateHour(symbol);
  const targetDateHour = cachedDateHour || "00000000000000";

  const allItems: { price: number; date: string; hour: string }[] = [];
  
  const now = new Date();
  const todayYYYYMMDD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  
  // 현재 시각부터 과거로 역추적 시작 (장마감 이후면 180000 상한선)
  let nextHour = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}00`;
  if (nextHour > "180000") nextHour = "180000";

  const LIMIT_HOUR = "080000"; 
  const MAX_PAGES = 30; // 가상모드도 넉넉하게 잡음
  
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

      const url = `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=${market}&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
      let data;
      try {
        data = await kisRateLimiter.enqueue(() => kisFetch(url, {
          method: "GET",
          headers: {
            "authorization": `Bearer ${accessToken}`,
            "appkey": appKey,
            "appsecret": appSecret,
            "tr_id": trId,
            "content-type": "application/json",
            "custtype": "P",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://openapivts.koreainvestment.com:29443",
            "Referer": "https://openapivts.koreainvestment.com:29443/"
          },
        }));
      } catch (err: any) {
        if (err.message && err.message.includes("EGW00123")) {
          console.log(`[Token Expired] fetchVirtualIntradayChart(${symbol}) EGW00123 감지, 갱신 중...`);
          accessToken = await getKisVirtualAccessToken(appKey, appSecret, true);
          page--; continue;
        }
        break;
      }

      if (data.msg_cd === "EGW00123") {
        console.log(`[Token Expired] fetchVirtualIntradayChart(${symbol}) EGW00123 감지, 갱신 중...`);
        accessToken = await getKisVirtualAccessToken(appKey, appSecret, true);
        page--; continue;
      }

      if (data.rt_cd !== '0') break;

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
        console.log(`[Virtual Chart API] ${symbol} NX valid data empty, retrying with Regular(J) market...`);
        const fallbackUrl = `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${nextHour}&FID_PW_DATA_INCU_YN=N&FID_ETC_CLS_CODE=&FID_PW_DATA_INC_CLQL_CODE=N`;
        try {
          const fbData = await kisRateLimiter.enqueue(() => kisFetch(fallbackUrl, {
            method: "GET",
            headers: {
              authorization: `Bearer ${accessToken}`,
              appkey: appKey,
              appsecret: appSecret,
              tr_id: "FHKST03010200",
              "content-type": "application/json",
              custtype: "P",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
              "Origin": "https://openapivts.koreainvestment.com:29443",
              "Referer": "https://openapivts.koreainvestment.com:29443/"
            },
          }));
          if (fbData.rt_cd === '0') {
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
        } catch (fbError) {
          console.warn(`[Virtual Chart API] Fallback to Regular(J) market failed for ${symbol}:`, fbError);
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
        console.log(`[Virtual Chart API] ${symbol} 데이터 바닥 도달. 08시 역추적 조기 종료.`);
        break;
      }

      nextHour = oldestHour; // 다음 루프는 이 시점부터 과거 방향으로
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      console.error(`Virtual Chart API fetch error for ${symbol}:`, e);
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
  const sortedNewItems = newItems.sort((a, b) => 
    (a.date + a.hour).localeCompare(b.date + b.hour)
  );
  
  console.log(`[Virtual Chart API RAW] targetDateHour: ${targetDateHour}, allItems: ${allItems.length}, unique: ${newItems.length}`);
  if (sortedNewItems.length > 0) {
    const first = sortedNewItems[0];
    const last = sortedNewItems[sortedNewItems.length - 1];
    console.log(`[Virtual Chart API RAW] First: ${first.date}${first.hour}, Last: ${last.date}${last.hour}`);
  }

  const mergedItems = ChartCacheManager.saveMergedItems(symbol, sortedNewItems);

  let dateRange = "";
  if (sortedNewItems.length > 0) {
    const first = sortedNewItems[0];
    const last = sortedNewItems[sortedNewItems.length - 1];
    dateRange = ` [${first.date} ${first.hour} ~ ${last.date} ${last.hour}]`;
  }

  console.log(`[Virtual Chart API] ${symbol}: ${newItems.length}개 추가로 수집${dateRange}, 총 ${mergedItems.length}개 (1분봉) 병합 완료`);
  return resampleTo10Minutes(mergedItems);
}


/**
 * REST API로 현재가 단건 조회 (모의투자, NXT 시장용)
 */
export async function fetchVirtualCurrentPriceNxt(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisVirtualAccessToken(appKey, appSecret);

  let data;
  try {
    data = await kisRateLimiter.enqueue(() => kisFetch(
      `${KIS_VIRTUAL_API_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=NX&fid_input_iscd=${symbol}`,
      {
        method: "GET",
        headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: "FHKST01010100", 
        "content-type": "application/json",
        custtype: "P",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://openapivts.koreainvestment.com:29443",
        "Referer": "https://openapivts.koreainvestment.com:29443/"
      }
    }));
  } catch (error: any) {
    // 토큰 만료 에러 (EGW00123) 시 강제 재발급 및 재시도
    if (error.message && error.message.includes("EGW00123")) {
      console.log(`[Token Expired] fetchVirtualCurrentPriceNxt(${symbol}) EGW00123 감지, 토큰 갱신 중...`);
      await getKisVirtualAccessToken(appKey, appSecret, true);
      return fetchVirtualCurrentPriceNxt(appKey, appSecret, symbol);
    }
    throw new Error(`모의투자 NXT 현재가 조회 실패: ${error.message}`);
  }

  if (data.msg_cd === "EGW00123") {
    console.log(`[Token Expired] fetchVirtualCurrentPriceNxt(${symbol}) EGW00123 감지, 토큰 갱신 중...`);
    await getKisVirtualAccessToken(appKey, appSecret, true);
    return fetchVirtualCurrentPriceNxt(appKey, appSecret, symbol);
  }

  if (data.rt_cd !== '0') {
    throw new Error(`모의투자 NXT 현재가 조회 실패: ${data.msg1}`);
  }

  const output = data.output;
  if (!output || !output.stck_prpr || output.stck_prpr === "0") {
    throw new Error(`모의투자 NXT 현재가 데이터 부재 (${symbol})`);
  }

  const currentPrice = parseFloat(output.stck_prpr) || 0;
  const changeRate = parseFloat(output.prdy_ctrt) || 0;
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
