# 프론트엔드 구조

이 문서는 `src/` 아래의 화면 구조와 상태 흐름을 정리합니다.

## 진입점과 라우팅

- [src/main.tsx](../src/main.tsx)
  - React 앱을 부트스트랩합니다.
  - 티커 창 경로에서 투명 배경 클래스를 먼저 적용합니다.
- [src/App.tsx](../src/App.tsx)
  - `/`는 제어판으로 라우팅합니다.
  - `/ticker/:symbol`은 개별 티커 창으로 라우팅합니다.

## 페이지

- [src/pages/ControlPanel.tsx](../src/pages/ControlPanel.tsx)
  - 종목 목록, 설정, 인증 정보, 매입 내역을 관리합니다.
  - 티커 창 생성/닫기/초기화 명령을 호출합니다.
  - 잠금, border, scale 상태를 전역으로 브로드캐스트합니다.
- [src/pages/TickerWidget.tsx](../src/pages/TickerWidget.tsx)
  - 종목 1개를 오버레이 창에 렌더링합니다.
  - 잠금, border, scale 이벤트를 반영합니다.
  - 잠금 해제 상태에서 더블 클릭 시 외부 브라우저를 엽니다.

## 컴포넌트

- [src/components/WsManager.tsx](../src/components/WsManager.tsx)
  - 화면을 렌더링하지 않는 조정자 역할입니다.
  - 초기 로드, 웹소켓, 폴백을 묶어서 실행합니다.
- [src/components/TickerCard.tsx](../src/components/TickerCard.tsx)
  - 현재가, 등락률, 종목명, 스파크라인을 표시합니다.
- [src/components/Sparkline.tsx](../src/components/Sparkline.tsx)
  - 미니 차트를 렌더링합니다.

## 훅

- [src/hooks/useInitialLoad.ts](../src/hooks/useInitialLoad.ts)
  - 활성 종목마다 최초 1회 가격과 차트를 불러옵니다.
  - `KisDataManager`로 중복 요청을 공유합니다.
- [src/hooks/useWebSocket.ts](../src/hooks/useWebSocket.ts)
  - KIS 실전 또는 모의투자 웹소켓에 연결합니다.
  - 실시간 틱을 차트 캐시에 반영합니다.
  - 이벤트 버스로 티커 데이터를 프론트에 전달합니다.
- [src/hooks/useFallback.ts](../src/hooks/useFallback.ts)
  - 웹소켓이 끊기거나 늦어질 때 폴백을 수행합니다.
  - KIS REST를 먼저 사용하고, 필요하면 Yahoo로 내려갑니다.

## 저장소와 공통 로직

- [src/lib/storage.ts](../src/lib/storage.ts)
  - 앱 설정을 localStorage에 저장합니다.
  - KIS 토큰, 활성 종목, 티커 위치, 매입 내역을 보관합니다.
- [src/lib/managers/KisDataManager.ts](../src/lib/managers/KisDataManager.ts)
  - 같은 종목의 동시 요청을 하나로 합칩니다.

## 참고

- 현재 프론트엔드 상태는 `dataSourceMode`처럼 단일 선택으로 가는 중이지만, 내부 저장은 아직 `isVirtual`, `kisEnabled`, `yahoo.enabled`를 함께 씁니다.
- 추후에는 provider 선택 상태를 하나로 모으는 편이 더 낫습니다.
