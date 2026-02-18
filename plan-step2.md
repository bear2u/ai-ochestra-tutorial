# Step2_plan.md — 워크플로우 엔진 뼈대 개발계획

```
phase 기반 실행 구조는 이걸 단계(state machine)로 쪼개는 것입니다.

예: planning -> architecture -> design -> implementation -> validation -> review -> packaging
각 단계마다 “무엇을 입력으로 받고, 어떤 결과를 내는지”를 명확히 고정
단계 전이(다음 단계로 갈지, 되돌릴지, 실패 종료할지)를 규칙으로 관리
왜 확장하냐면, 최종 목표가 “기획/설계/디자인/개발/테스트/리뷰 자율 오케스트레이션”이기 때문입니다.

단일 Dev/Test 루프로는 기획·설계·리뷰를 구조적으로 넣기 어려움
단계별 로그/상태 추적이 쉬워짐 (currentPhase, phase 이벤트)
단계별 재시도/타임아웃/실패 처리 정책을 다르게 줄 수 있음
나중에 에이전트 추가/교체가 쉬워짐 (확장성)
한 줄로 정리하면:
기능을 늘리기 위해서가 아니라, “복잡한 멀티에이전트 일을 통제 가능하게 만들기 위해” phase 구조로 바꾸는 것입니다.
```

## 1. 요약
- 목적: `step1`의 2-agent 루프를 깨지지 않게 유지하면서, `Supervisor`를 phase 기반 실행 구조로 전환한다.
- 핵심: Step2에서는 “엔진 뼈대 + 이벤트 확장 + 회귀 보장”까지만 수행한다.
- 범위: 실제 `Planner/Architect/Designer/Reviewer/Packager` 구현은 Step3 이후로 미룬다.

## 2. Step2 범위
1. In Scope
- `Supervisor` phase 실행 순서 도입
- `PhaseName`, `PhaseStatus` 타입 추가
- `SessionEvent`에 `phase`, `iteration` 추가
- 기존 Dev/Test를 각각 `implementation`/`validation` phase에 매핑
- 회귀 테스트 추가(기존 API/SSE/세션 흐름 유지)

2. Out of Scope
- 신규 에이전트 실구현
- ArtifactStore/아티팩트 계약
- patch 적용 전략
- 리뷰 점수/PR 패키지 생성

## 3. 공개 인터페이스/타입 변경
1. `src/types.ts` 확장
- `type PhaseName = "planning" | "architecture" | "design" | "implementation" | "validation" | "review" | "packaging"`
- `type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped"`

2. `SessionState` 확장
- `currentPhase?: PhaseName`
- `iteration: number` 유지(의미를 “구현-검증 루프 회차”로 고정)
- `phaseStatuses?: Record<PhaseName, PhaseStatus>`

3. `SessionEvent` 확장
- `phase?: PhaseName`
- `iteration?: number`

4. API 호환성
- 기존 엔드포인트 유지: `/api/health`, `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/events`
- 요청 스키마는 Step2에서 변경하지 않음(`task`, `filePaths`, `testCommand`, `maxAttempts` 유지)

## 4. 런타임 실행 설계
1. 고정 phase 순서
- `planning -> architecture -> design -> implementation -> validation -> review -> packaging`

2. Step2 phase 동작 정의
- `planning`, `architecture`, `design`, `review`, `packaging`: no-op phase (시작/완료 이벤트만 기록)
- `implementation`: 기존 DevAgent 호출 + 파일 변경 반영
- `validation`: 기존 CommandRunner + TestAgent 평가

3. 반복 규칙
- `implementation -> validation`만 `maxAttempts` 기반 반복
- `validation` 통과 시 루프 종료 후 `review`, `packaging` no-op 완료
- `validation` 실패 시 다음 iteration으로 진행
- `maxAttempts` 소진 시 세션 `failed`

## 5. 코드 변경 계획
1. `src/orchestrator/supervisor.ts`
- phase 실행 함수 분리
- no-op phase executor 추가
- implementation/validation executor 추가
- 이벤트에 `phase`, `iteration` 채워서 기록

2. `src/services/sessionStore.ts`
- 이벤트 payload에 `phase`, `iteration` 저장 가능하게 확장
- 세션 상태에 `currentPhase`, `phaseStatuses` 업데이트 헬퍼 추가

3. `src/types.ts`
- phase 관련 타입 추가 및 기존 타입과 호환 유지

4. `src/serverApp.ts`
- 세션 조회 응답에 확장된 state/event가 노출되는지 확인
- 스키마 변경 없이 회귀 유지

## 6. 테스트 계획 (TDD)
1. 단위 테스트
- phase 순서 실행 검증
- no-op phase 이벤트 기록 검증
- implementation/validation phase 매핑 검증
- `SessionEvent.phase`, `SessionEvent.iteration` 필드 검증

2. 통합 테스트
- 성공 시나리오: 1회 iteration 후 success
- 실패 시나리오: `maxAttempts` 소진 후 failed
- 회귀 시나리오: 기존 `serverApp` 테스트 전부 통과

3. 수용 기준
- 기존 API 테스트가 깨지지 않는다.
- 이벤트 스트림에서 phase가 순서대로 보인다.
- 실패/성공 상태 전이가 기존 의미와 충돌하지 않는다.

## 7. 리스크와 대응
1. 리스크
- 기존 이벤트 소비 UI가 확장 필드를 처리 못할 수 있음
- phase 도입 중 Supervisor 로직 회귀 가능성

2. 대응
- 기존 이벤트 필드는 유지하고 확장 필드만 optional로 추가
- Step1 회귀 테스트를 Step2 필수 게이트로 고정

## 8. 완료 정의 (Definition of Done)
1. `pnpm test` 전체 통과
2. phase 이벤트 포함 세션 1회 성공/실패 시나리오 확인
3. `README.md`에 Step2 변경점 5줄 요약 반영
4. Step3에서 신규 에이전트를 붙일 수 있는 executor 인터페이스 확보

## 9. 가정 및 기본값
1. Step2는 구조 확장 단계이며 제품 기능 확장은 최소화한다.
2. 승인 정책은 Step2에서 도입하지 않는다(완전 자율 목표는 Step5+에서 반영).
3. validation 명령은 기존 `testCommand` 1개를 그대로 사용한다.
4. Step2 완료 후 Step3에서 Planner/Architect/Designer 실구현을 시작한다.
