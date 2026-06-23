# 데이터 소스와 브리지 구조

이 문서는 API 선택, 데이터 수집, Tauri 브리지 구조를 정리합니다.

## 현재 데이터 소스

- KIS 실전 API
- KIS 모의투자 API
- Yahoo Finance
- 토스 OpenAPI

## 개발 기준 요약

- 시세 관련 기능은 `provider` 인터페이스로 분리합니다.
- KIS 실전과 모의투자는 공통 베이스를 공유합니다.
- Yahoo는 별도 구현체로 둡니다.
- 토스 OpenAPI는 동일 인터페이스를 구현하는 provider입니다.
- 토스는 웹소켓이 없으므로 현재가 폴링으로 실시간성을 보완합니다.
- UI는 `dataSourceMode` 하나만 바라보고, 자동 fallback은 사용하지 않습니다.

## 추가 설계 문서

- [provider 설계](./PROVIDER_DESIGN.md)

## KIS 계층

- [src/lib/kisApi.ts](../src/lib/kisApi.ts)
  - 실전 KIS 현재가, 차트, 웹소켓 승인키, 토큰 발급을 담당합니다.
- [src/lib/kisVirtualApi.ts](../src/lib/kisVirtualApi.ts)
  - 모의투자용 KIS 구현입니다.
- [src/lib/managers/KisDataManager.ts](../src/lib/managers/KisDataManager.ts)
  - 현재가와 차트 요청을 공유 Promise로 중복 제거합니다.

## Yahoo 계층

- [src/lib/fallbackApi.ts](../src/lib/fallbackApi.ts)
  - Yahoo Finance 차트 API를 사용합니다.
  - 사용자가 Yahoo 모드를 선택했을 때만 동작합니다.

## 상태와 분기

- [src/lib/storage.ts](../src/lib/storage.ts)
  - 현재 모드는 `isVirtual`, `kisEnabled`, `apis.yahoo.enabled` 조합으로 저장됩니다.
- [src/hooks/useInitialLoad.ts](../src/hooks/useInitialLoad.ts)
  - 현재 설정을 읽고 적절한 데이터 소스를 선택합니다.
- [src/hooks/useWebSocket.ts](../src/hooks/useWebSocket.ts)
  - KIS 실전 또는 모의투자 웹소켓에 직접 연결합니다.
- 자동 fallback 훅은 제거되었습니다.

## Tauri 브리지

- [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)
  - 창 생성, 닫기, 상태 초기화, 잠금 토글, 스케일 브로드캐스트를 담당합니다.
  - KIS 요청은 `kis_fetch_proxy`로 Rust가 대신 전송합니다.
- Tauri 이벤트
  - `lock-toggled`
  - `border-toggled`
  - `scale-changed`
  - `window-moved`
  - `kis-ticker-data-<symbol>`
  - `kis-ticker-error-<symbol>`

## 토스 OpenAPI 참고

- [docs/toss_openapi.json](./toss_openapi.json)
  - 토스증권 OpenAPI 전체 스펙입니다.
  - 현재 앱에는 붙어 있지 않지만, 향후 provider로 추가할 때 참고할 수 있습니다.

## 구조 판단

- KIS 실전과 모의투자는 공통 베이스를 두기 좋습니다.
- Yahoo는 인증과 응답 형태가 달라 별도 provider가 자연스럽습니다.
- 토스는 KIS와 다른 계층이므로, 같은 부모 class에 억지로 넣기보다 인터페이스 기반으로 묶는 편이 낫습니다.
