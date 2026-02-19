# Planning Phase 이벤트 스모크 테스트

<a id='planning-goal'></a>
## 목표
Step3 pre-loop 구간에서 Planning phase 진입/종료 핵심 경로를 단일 스모크로 검증한다.

<a id='planning-scope'></a>
## 범위
- Planning 시작/완료 이벤트 발행 여부
- 이벤트 순서(시작 -> 완료)
- 필수 필드(`phase`, `timestamp`, 실행 식별자) 존재 여부
- 동일 실행 단위(`run_id`) 연결성

<a id='planning-out-of-scope'></a>
## 제외 범위
- 성능/부하/지연 시간 최적화
- 비핵심 부가 이벤트 전체 검증
- UI/리포트 렌더링 품질

<a id='planning-conventions'></a>
## 공통 규약
- 실행 식별자는 `run_id`를 표준으로 사용한다. 원본에 `correlation_id`가 있으면 동일 의미로 간주한다.
- 이벤트명은 표준명과 레거시 별칭을 모두 허용한다.
- 시작 이벤트: `planning.started` 또는 `planning_phase_started`
- 완료 이벤트: `planning.completed` 또는 `planning_phase_completed`
- blocking 시나리오는 `P0`로 분류하며 `must=true`로 취급한다.

<a id='planning-preconditions'></a>
## 사전 조건
- Planning phase 시작/완료 액션을 수동 또는 스크립트로 실행할 수 있다.
- 이벤트 수집 로그(큐/웹훅/로그 파일) 접근 권한이 있다.
- 테스트 실행 단위(`run_id` 또는 `correlation_id`)를 확인할 수 있다.

<a id='planning-scenarios'></a>
## 시나리오

<a id='tc-pln-01'></a>
### TC-PLN-01 정상 플로우 (P0, MUST)
1. Planning phase 시작 액션을 실행한다.
2. 시작 이벤트(`planning.started` 또는 `planning_phase_started`) 1회를 확인한다.
3. Planning 완료 액션을 실행한다.
4. 완료 이벤트(`planning.completed` 또는 `planning_phase_completed`) 1회를 확인한다.
5. 두 이벤트의 `phase=planning` 및 동일 실행 식별자(`run_id`/`correlation_id`)를 확인한다.

<a id='planning-expected-results'></a>
## 기대 결과
- 시작 이벤트가 1회 수신된다.
- 완료 이벤트가 1회 수신된다.
- 각 이벤트 payload에 `phase=planning`, `timestamp`, 실행 식별자가 포함된다.
- 시작 이벤트 `timestamp`가 완료 이벤트 `timestamp`보다 같거나 빠르다.

<a id='planning-pass-criteria'></a>
## 합격 기준
- MUST 시나리오(TC-PLN-01) 실패가 0건이다.
- 이벤트 누락/중복이 없고 필수 필드 누락이 없다.

<a id='planning-gate'></a>
## 게이트 판정
- `must=true` 시나리오 실패가 1건 이상이면 Planning 도메인 결과는 `NO_GO`다.
- `must=true` 시나리오 실패가 0건이면 Planning 도메인 결과는 `GO`다.

<a id='planning-matrix-mapping'></a>
## 매트릭스 매핑
| id | domain | priority | must | source_doc | source_anchor |
| --- | --- | --- | --- | --- | --- |
| TC-PLN-01 | planning | P0 | true | playground/planning-smoke.md | #tc-pln-01 |

<a id='planning-repro'></a>
## 재현 커맨드
- 전체: `scripts/smoke/step3-preloop.sh`
- 도메인 단건: `scripts/smoke/step3-preloop.sh --domain planning`
- 시나리오 단건(예시): `scripts/smoke/step3-preloop.sh --domain planning --scenario TC-PLN-01`
