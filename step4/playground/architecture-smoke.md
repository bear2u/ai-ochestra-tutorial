# Architecture Phase 이벤트 스모크 테스트

<a id='architecture-goal'></a>
## 목표
Step3 pre-loop 구간에서 Architecture phase의 성공/실패 핵심 이벤트 경로를 검증한다.

<a id='architecture-scope'></a>
## 범위
- 정상 경로(`started -> completed`) 이벤트 검증
- 실패 경로(`failed`) 이벤트 검증
- 동일 실행 단위(`run_id`) 연결성과 필수 필드 검증

<a id='architecture-out-of-scope'></a>
## 제외 범위
- 오류 메시지 문구의 세부 표현 품질
- 비핵심 부가 이벤트 전체 검증
- 성능/부하 테스트

<a id='architecture-conventions'></a>
## 공통 규약
- 실행 식별자는 `run_id`를 표준으로 사용한다. 이벤트의 `correlation_id`는 동일 의미로 매핑한다.
- 표준 이벤트명: `architecture.started`, `architecture.completed`, `architecture.failed`
- blocking 시나리오는 `P0`로 분류하며 `must=true`로 취급한다.

<a id='architecture-preconditions'></a>
## 사전 조건
- Architecture phase를 수동 실행할 수 있다.
- 이벤트 로그(또는 버스)를 확인할 수 있다.
- 테스트별 `run_id` 또는 `correlation_id`를 확인할 수 있다.

<a id='architecture-scenarios'></a>
## 시나리오

<a id='tc-arc-01'></a>
### TC-ARC-01 정상 플로우 (P0, MUST)
1. Architecture phase를 정상 입력으로 실행한다.
2. `architecture.started` 이벤트 발행을 확인한다.
3. 완료 후 `architecture.completed` 이벤트 발행을 확인한다.

<a id='tc-arc-02'></a>
### TC-ARC-02 실패 플로우 (P0, MUST)
1. 의도적으로 잘못된 입력으로 Architecture phase를 실행한다.
2. `architecture.failed` 이벤트 발행을 확인한다.
3. 동일 실행 식별자(`run_id`/`correlation_id`)에 `architecture.completed`가 발행되지 않았는지 확인한다.

<a id='architecture-expected-results'></a>
## 기대 결과
- TC-ARC-01: 이벤트 순서가 `started -> completed` 이다.
- TC-ARC-01: 두 이벤트가 동일한 실행 식별자(`run_id`/`correlation_id`)를 가진다.
- TC-ARC-01: 필수 필드(`phase`, `status`, `timestamp`, 실행 식별자)가 존재한다.
- TC-ARC-02: `error.code`, `error.message`, 실행 식별자가 존재한다.
- TC-ARC-02: 성공 이벤트(`architecture.completed`)는 발행되지 않는다.

<a id='architecture-pass-criteria'></a>
## 합격 기준
- MUST 시나리오(TC-ARC-01, TC-ARC-02) 실패가 0건이다.
- 이벤트 누락이 없고 이벤트 스키마 필수 필드 누락이 없다.

<a id='architecture-gate'></a>
## 게이트 판정
- `must=true` 시나리오 실패가 1건 이상이면 Architecture 도메인 결과는 `NO_GO`다.
- `must=true` 시나리오 실패가 0건이면 Architecture 도메인 결과는 `GO`다.

<a id='architecture-matrix-mapping'></a>
## 매트릭스 매핑
| id | domain | priority | must | source_doc | source_anchor |
| --- | --- | --- | --- | --- | --- |
| TC-ARC-01 | architecture | P0 | true | playground/architecture-smoke.md | #tc-arc-01 |
| TC-ARC-02 | architecture | P0 | true | playground/architecture-smoke.md | #tc-arc-02 |

<a id='architecture-repro'></a>
## 재현 커맨드
- 전체: `scripts/smoke/step3-preloop.sh`
- 도메인 단건: `scripts/smoke/step3-preloop.sh --domain architecture`
- 시나리오 단건(예시): `scripts/smoke/step3-preloop.sh --domain architecture --scenario TC-ARC-02`
