# Architecture Phase 이벤트 스모크 테스트

## 목적
Architecture phase 실행 시 핵심 이벤트가 정상적으로 발행되는지 최소 경로를 검증한다.

## 사전 조건
- Architecture phase를 수동 실행할 수 있다.
- 이벤트 로그(또는 버스)를 확인할 수 있다.

## 테스트 케이스

### TC-01 정상 플로우
1. Architecture phase를 실행한다.
2. `architecture.started` 이벤트가 발행되는지 확인한다.
3. 완료 후 `architecture.completed` 이벤트가 발행되는지 확인한다.

예상 결과:
- 이벤트 순서가 `started -> completed` 이다.
- 두 이벤트가 동일한 `correlation_id`를 가진다.
- 필수 필드(`phase`, `status`, `timestamp`)가 존재한다.

### TC-02 실패 플로우
1. 의도적으로 잘못된 입력으로 Architecture phase를 실행한다.
2. `architecture.failed` 이벤트가 발행되는지 확인한다.

예상 결과:
- `error.code`, `error.message`, `correlation_id`가 존재한다.
- 성공 이벤트(`architecture.completed`)는 발행되지 않는다.

## 합격 기준
- TC-01, TC-02 모두 이벤트 누락이 없다.
- 이벤트 스키마 필수 필드 누락이 없다.
