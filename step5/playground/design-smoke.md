# Design Phase 이벤트 스모크 테스트

<a id='design-goal'></a>
## 목표
Step3 pre-loop 구간에서 Design phase의 핵심 이벤트와 아티팩트 생성 경로를 빠르게 검증한다.

<a id='design-scope'></a>
## 범위
- `designer` 역할 이벤트 가시성(시작/진행/완료)
- 아티팩트 생성 이벤트 발행 및 `artifact_id` 유효성
- 이벤트와 아티팩트 간 실행 식별자(`run_id`) 연결성

<a id='design-out-of-scope'></a>
## 제외 범위
- 디자인 산출물의 시각 품질/사용성 평가는 제외
- 대량 아티팩트 생성 성능 검증은 제외
- 비핵심 부가 이벤트 전체 검증은 제외

<a id='design-conventions'></a>
## 공통 규약
- 실행 식별자는 `run_id`를 표준으로 사용한다. 이벤트의 `correlation_id`는 동일 의미로 매핑한다.
- 이벤트명은 표준명과 레거시 별칭을 모두 허용한다.
- 디자이너 이벤트: `design.designer.started|progress|completed` 또는 `designer` 역할의 시작/진행/완료 이벤트
- 아티팩트 이벤트: `design.artifact_created` 또는 `artifact_created`
- blocking 시나리오는 `P0`로 분류하며 `must=true`로 취급한다.

<a id='design-preconditions'></a>
## 사전 조건
- Design phase를 실행할 수 있다.
- 이벤트 로그(또는 버스)에서 `designer` 역할 이벤트를 조회할 수 있다.
- 생성된 디자인 아티팩트 저장소(또는 API)에서 `artifact_id` 조회가 가능하다.

<a id='design-scenarios'></a>
## 시나리오

<a id='tc-des-01'></a>
### TC-DES-01 designer 이벤트 가시성 (P0, MUST)
1. Design phase를 실행한다.
2. `designer` 역할의 시작/진행/완료 이벤트가 로그에 노출되는지 확인한다.
3. 동일 실행 단위(`run_id` 또는 `correlation_id`)로 이벤트가 연결되는지 확인한다.

<a id='tc-des-02'></a>
### TC-DES-02 아티팩트 생성 검증 (P0, MUST)
1. Design 산출물이 생성되는 경로를 실행한다.
2. 아티팩트 생성 이벤트(`design.artifact_created` 또는 `artifact_created`) 발행을 확인한다.
3. 이벤트 payload의 `artifact_id`가 비어 있지 않은지 확인한다.
4. `artifact_id`로 실제 아티팩트를 조회했을 때 1건이 존재하는지 확인한다.

<a id='design-expected-results'></a>
## 기대 결과
- `designer` 역할 이벤트(시작/진행/완료)가 누락 없이 조회된다.
- 아티팩트 생성 이벤트가 1회 이상 발행된다.
- 이벤트 payload의 `artifact_id`가 null/empty가 아니다.
- `artifact_id`로 조회한 아티팩트가 Design 산출물로 식별 가능하다.
- 각 이벤트에 `timestamp`와 실행 식별자가 포함된다.

<a id='design-pass-criteria'></a>
## 합격 기준
- MUST 시나리오(TC-DES-01, TC-DES-02) 실패가 0건이다.
- 이벤트/아티팩트 상호 참조(`run_id` 또는 `correlation_id`)가 깨지지 않는다.

<a id='design-gate'></a>
## 게이트 판정
- `must=true` 시나리오 실패가 1건 이상이면 Design 도메인 결과는 `NO_GO`다.
- `must=true` 시나리오 실패가 0건이면 Design 도메인 결과는 `GO`다.

<a id='design-matrix-mapping'></a>
## 매트릭스 매핑
| id | domain | priority | must | source_doc | source_anchor |
| --- | --- | --- | --- | --- | --- |
| TC-DES-01 | design | P0 | true | playground/design-smoke.md | #tc-des-01 |
| TC-DES-02 | design | P0 | true | playground/design-smoke.md | #tc-des-02 |

<a id='design-repro'></a>
## 재현 커맨드
- 전체: `scripts/smoke/step3-preloop.sh`
- 도메인 단건: `scripts/smoke/step3-preloop.sh --domain design`
- 시나리오 단건(예시): `scripts/smoke/step3-preloop.sh --domain design --scenario TC-DES-02`
