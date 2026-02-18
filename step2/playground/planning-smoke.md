# Planning Phase 이벤트 스모크 테스트

## 목표
Planning 단계 진입/종료 이벤트가 정상 발행되는지 빠르게 검증한다.

## 시나리오
1. Planning Phase 시작 액션을 실행한다.
2. 이벤트 수집 로그(또는 큐/웹훅)에서 시작 이벤트를 확인한다.
3. Planning 완료 액션을 실행한다.
4. 종료 이벤트를 확인한다.

## 기대 결과
- `planning_phase_started` 이벤트가 1회 수신된다.
- `planning_phase_completed` 이벤트가 1회 수신된다.
- 각 이벤트 payload에 `phase=planning` 값이 포함된다.
