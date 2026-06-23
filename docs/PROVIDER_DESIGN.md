# Provider 설계

이 문서는 시세 데이터 공급자를 어떻게 나눌지, 어떤 규칙으로 선택할지, 어떤 책임을 공통화할지를 정의합니다.

## 목적

- `src/pages/ControlPanel.tsx`의 선택값 하나로 데이터 소스를 교체할 수 있게 합니다.
- KIS 실전/모의/Yahoo/Toss를 같은 호출 규격으로 다루게 합니다.
- 인증, 재시도, 에러 처리, 차트 정규화를 중복 없이 관리합니다.

## 핵심 원칙

- 공통 로직은 인터페이스가 아니라 베이스 클래스와 헬퍼로 공유합니다.
- 브로커별 차이는 구현체에서 처리합니다.
- UI는 provider의 내부 구현을 알지 못하게 합니다.
- 모드 전환은 명시적입니다. 숨은 자동 전환은 최소화합니다.

## 도메인 분리

- 시세
  - 현재가
  - 분봉 차트
  - 실시간 스트리밍
- 계좌
  - 계좌 목록
  - 보유 자산
- 주문
  - 주문 생성
  - 주문 취소
  - 주문 조회

이 프로젝트의 현재 범위는 **시세**입니다.
계좌와 주문은 추후 확장 대상으로 둡니다.

## 인터페이스 초안

```ts
export type DataSourceMode = "real" | "virtual" | "yahoo" | "toss";

export interface MarketPriceResult {
  symbol: string;
  currentPrice: number | string;
  changeRate: number | string;
  isUp: boolean;
  isDown: boolean;
  basePrice?: number;
  dataSource: "KIS" | "Yahoo" | "Toss";
  updatedAt: number;
  intradayPrices?: ChartPoint[];
}

export interface MarketDataProvider {
  readonly mode: DataSourceMode;
  canHandle(symbol: string): boolean;
  fetchPrice(symbol: string): Promise<MarketPriceResult>;
  fetchChart(symbol: string): Promise<ChartPoint[]>;
  connectRealtime?(symbols: Set<string>): Promise<void>;
  disconnectRealtime?(): Promise<void>;
}
```

## 공통 베이스

### `BaseKisProvider`

KIS 실전과 모의투자에 공통으로 쓰는 베이스입니다.

공통 책임:
- 토큰 발급
- 승인키 발급
- 공통 헤더 생성
- `kisFetch` 호출
- JSON 파싱 및 에러 포맷 통일
- 차트 리샘플링
- 공통 rate limit 적용

### `BaseHttpProvider`

토스나 Yahoo 같은 다른 계열에서 재사용할 수 있는 HTTP 베이스입니다.

공통 책임:
- HTTP 요청 래핑
- 오류 메시지 표준화
- 응답 JSON 검증

## 구현체

- `KisRealProvider`
  - 실전 KIS API 사용
  - 실전 토큰과 승인키 사용
  - 실시간 웹소켓 연결 사용
- `KisVirtualProvider`
  - 모의투자 KIS API 사용
  - 모의 토큰과 승인키 사용
  - 실시간 웹소켓 연결 사용
- `YahooProvider`
  - KIS 인증 없이 Yahoo Finance 사용
  - 실시간 연결 없음
  - 폴백 전용
- `TossProvider`
  - 토스 OpenAPI 기반 구현
  - 현재가와 분봉 차트 조회 구현
  - OAuth2 Client Credentials 토큰 발급 사용
  - 실시간 갱신은 REST 폴링으로 처리

## 선택 규칙

### 단일 선택 원칙

- 한 시점에 활성 provider는 하나만 둡니다.
- 사용자는 `dataSourceMode` 하나를 선택합니다.
- 선택 결과는 설정 저장소에 기록합니다.

### 모드 해석

- `real`
  - KIS 실전 provider 사용
  - `isVirtual = false`
  - `kisEnabled = true`
  - Yahoo 폴백은 비활성화
- `virtual`
  - KIS 모의 provider 사용
  - `isVirtual = true`
  - `kisEnabled = true`
  - Yahoo 폴백은 비활성화
- `yahoo`
  - Yahoo provider 사용
  - `kisEnabled = false`
  - `isVirtual` 값은 의미상 유지 가능하지만 동작에는 영향 없음
- `toss`
  - Toss provider 사용
  - `client_id` / `client_secret` 기반 OAuth2 인증 사용
  - 웹소켓 대신 10초 간격 폴링으로 실시간성 갱신
  - 폴링 간격은 설정값으로 조정 가능

## 전환 규칙

- 기본 원칙: 사용자가 명시한 provider를 우선합니다.
- 자동 fallback은 사용하지 않습니다.
- KIS 실전과 모의는 서로 자동 전환하지 않습니다.
- Yahoo와 Toss는 별도 선택 provider입니다.
- 실패 시 동작은 provider 내부 재시도까지만 허용합니다.

## 인증 규칙

- KIS 실전과 모의는 인증 토큰을 별도로 저장합니다.
- 토큰 갱신은 provider 내부에서 처리합니다.
- UI는 토큰의 존재 여부만 간접적으로 반영합니다.
- Yahoo는 인증이 없습니다.
- Toss는 토스 OpenAPI 인증 규칙을 따로 둡니다.

## 파일 구조 제안

```text
src/lib/providers/
  base/
    BaseHttpProvider.ts
    BaseKisProvider.ts
  kis/
    KisRealProvider.ts
    KisVirtualProvider.ts
  yahoo/
    YahooProvider.ts
  toss/
    TossProvider.ts
  ProviderFactory.ts
  types.ts
```

## 적용 순서

1. `DataSourceMode`와 `MarketDataProvider` 타입을 추가합니다.
2. KIS 실전/모의를 `BaseKisProvider`로 통합합니다.
3. Yahoo를 별도 provider로 빼고, 지금의 fallback 로직을 연결합니다.
4. `ControlPanel`과 `storage.ts`에서 선택값을 `dataSourceMode` 중심으로 정리합니다.
5. `useInitialLoad`, `useWebSocket`, `useFallback`이 provider 인터페이스만 보게 바꿉니다.
6. 토스 provider는 나중에 같은 인터페이스로 추가합니다.

## 구현 기준

- UI는 provider 구현 세부를 직접 참조하지 않습니다.
- 비즈니스 로직은 훅과 provider로 나눕니다.
- Rust는 브리지와 창 제어만 담당합니다.
- 데이터 소스 추가는 provider 파일 추가와 factory 등록으로 끝나야 합니다.
