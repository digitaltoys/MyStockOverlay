import { fetch } from '@tauri-apps/plugin-http';

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
 * Access Token 발급 로직
 */
export async function getKisAccessToken(appKey: string, appSecret: string): Promise<string> {
  // 로컬 스토리지 캐싱 확인 (간단 구현)
  const cached = localStorage.getItem("kis_access_token");
  const cachedTime = localStorage.getItem("kis_token_time");
  
  if (cached && cachedTime) {
    const now = Date.now();
    const age = now - parseInt(cachedTime);
    // 토큰 유효기간이 보통 24시간이므로 12시간 내외면 재사용
    if (age < 12 * 60 * 60 * 1000) {
      return cached;
    }
  }

  const response = await fetch(`${KIS_API_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("KIS Token Error:", response.status, errorText);
    throw new Error(`Access Token 발급 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const token = data.access_token;
  
  localStorage.setItem("kis_access_token", token);
  localStorage.setItem("kis_token_time", Date.now().toString());
  
  return token;
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

  const response = await fetch(
    `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`,
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
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`현재가 조회 실패: ${response.status} ${errorText}`);
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
 * REST API로 현재가 단건 조회 (NXT 시장용)
 */
export async function fetchCurrentPriceNxt(appKey: string, appSecret: string, symbol: string): Promise<KisTickerData> {
  const accessToken = await getKisAccessToken(appKey, appSecret);

  const response = await fetch(
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
  );

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
export function parseTickerData(symbol: string, rawData: string): KisTickerData {
  // 실제 데이터는 '데이터구분|종목코드|실제데이터' 형태로 옴
  const parts = rawData.split('|');
  if (parts.length < 4) throw new Error("Invalid WS data format");
  
  const details = parts[3].split('^');
  
  // H0STCNT0 실데이터 파싱 구조 판별 (스크린샷 기반)
  // [0]종목코드, [1]체결시간, [2]현재가, [3]전일대비부호, [4]전일대비금액, [5]전일대비율, [6]...
  const parsedPrice = parseInt(details[2]);
  const parsedRate = parseFloat(details[5]);
  
  const currentPrice = isNaN(parsedPrice) ? details[2] || "N/A" : parsedPrice;
  const changeRate = isNaN(parsedRate) ? details[5] || "0" : parsedRate;
  
  const diffSign = details[3]; // 1:상한, 2:상승, 3:보합, 4:하한, 5:하락
  
  return {
    symbol,
    currentPrice,
    changeRate,
    isUp: diffSign === '1' || diffSign === '2',
    isDown: diffSign === '4' || diffSign === '5',
    rawDetails: details.slice(0, 8),
  };
}
