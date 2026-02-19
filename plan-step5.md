# Step5 최종 확장 개발 계획서 (Step4 -> Step5)

## 1. 요약
1. 목표는 `step5`에서 `review`를 no-op 단계가 아닌 실제 `ReviewerAgent` 실행 단계로 전환하는 것입니다.
2. 핵심은 `validation` 통과 후 리뷰를 수행하고, `blockingIssues`가 있으면 `implementation`으로 자동 회귀하는 자율 재작업 루프를 구현하는 것입니다.
3. 예산 제어(`maxIterations`, `maxMinutes`)를 도입하고, 예산 소진 시 `failed_budget_exhausted`로 안전 종료합니다.
4. 기존 Step4 입력(`maxAttempts`)은 하위호환으로 유지하고 내부에서 `maxIterations`로 매핑합니다.

## 2. 현재 기준선
1. Step4는 `planning -> architecture -> design -> implementation -> validation` 실구현 상태입니다.
2. `review`, `packaging`은 현재 no-op입니다.
3. Validation pipeline/실패 분류/ValidationArtifact는 이미 구현되어 있습니다.
4. Step5 구현은 Step4 복사본 기반으로 진행합니다.

## 3. 범위 정의

## In Scope
1. `ReviewerAgent` 신규 구현.
2. `ReviewArtifact` 타입/스키마/저장/참조/이벤트 연동.
3. Supervisor 루프 확장: `implementation -> validation -> review` 반복.
4. 예산 제어 도입: `maxIterations`, `maxMinutes`, `failed_budget_exhausted`.
5. 입력 하위호환: `maxAttempts` 유지.
6. UI 풀 반영: reviewer 필터, review summary, budget 입력/상태, Step5 프리셋.
7. 테스트/문서 정리.

## Out of Scope
1. Packager 실구현 및 PR 패키지 API는 Step6에서 처리.
2. 세션 영속화/복구는 Step7에서 처리.
3. 운영 하드닝은 Step8에서 처리.

## 4. 공개 인터페이스/타입 변경

## 4.1 `step5/src/types.ts`
1. `AgentRole` 확장: `"reviewer"` 추가.
2. `SessionInput` 확장:
`maxIterations?: number`, `maxMinutes?: number`, `maxAttempts?: number(legacy)`.
3. `SessionState` 확장:
`budget` 필드 추가.
4. `artifactRefs` 확장:
`review?: string`.
5. 신규 타입:
`ReviewIssue`, `ReviewArtifact`, `Step5Artifact`.

## 4.2 API 입력 규칙 (`POST /api/sessions`)
1. 유지 필드:
`task`, `filePaths`, `testCommand`, `validationCommands`.
2. 신규 필드:
`maxIterations`, `maxMinutes`.
3. 하위호환:
`maxAttempts` 허용.
4. 정규화 규칙:
`effectiveMaxIterations = maxIterations ?? maxAttempts ?? 6`.
`effectiveMaxMinutes = maxMinutes ?? 45`.
5. 기존 one-of 유지:
`testCommand` 또는 `validationCommands` 중 하나 필수.

## 4.3 이벤트 계약
1. 신규 이벤트:
`review_blocking_detected`, `review_approved`, `budget_exhausted`.
2. 종료 이벤트:
예산 소진 시 `session_finished` 메시지에 `failed_budget_exhausted` 명시.
3. `SessionEvent.data`에 budget snapshot 포함:
`elapsedMs`, `remainingIterations`, `reason`.

## 5. Artifact 계약

## 5.1 ReviewArtifact
1. 필드:
`id`, `sessionId`, `phase:"review"`, `iteration`, `blockingIssues[]`, `nonBlockingIssues[]`, `score`, `fixPlan[]`, `createdAt`.
2. 저장:
iteration마다 누적 저장.
3. 세션 참조:
`artifactRefs.review`는 latest id만 유지.

## 5.2 Reviewer 판정 규칙
1. 회귀 기준은 `blockingIssues.length > 0`만 사용.
2. `score`는 참고 지표이며 회귀 트리거로 사용하지 않음.
3. blocking 발생 시 `fixPlan`을 다음 iteration feedback에 주입.

## 6. 런타임 플로우 설계

## 6.1 상위 단계
1. `planning -> architecture -> design`은 기존 Step4와 동일하게 실행.

## 6.2 반복 루프
1. iteration 시작 시 예산 검사(횟수/시간).
2. `implementation` 실행.
3. `validation` 실행.
4. validation 실패 시 feedback 갱신 후 다음 iteration.
5. validation 성공 시 `review` 실행.
6. review blocking 존재 시 `review_blocking_detected` 이벤트 후 feedback 보강, 다음 iteration.
7. review blocking 없음 시 `review_approved` 후 루프 종료.
8. 루프 종료 후 `packaging` phase 실행(no-op 유지), session success 종료.

## 6.3 예산 소진 종료
1. iteration 초과 또는 deadline 초과 시 `budget_exhausted`.
2. 남은 phase는 `skipped` 처리.
3. 최종 상태는 `failed`, `finalSummary`는 `failed_budget_exhausted`.

## 7. 서비스 설계

## 7.1 BudgetTracker (`step5/src/services/budgetTracker.ts`)
1. 입력:
`maxIterations`, `maxMinutes`, `startedAt`.
2. 메서드:
`canStartIteration(iterationNow): { ok, reason?, snapshot }`.
`snapshot(iterationNow): BudgetSnapshot`.
3. 판정:
`iterationNow > maxIterations` 또는 `Date.now() > deadlineAt`이면 exhausted.

## 7.2 ArtifactStore 확장
1. review artifacts 배열 누적 저장.
2. `get(sessionId, "review")`, `getReviewArtifacts(sessionId)` 추가.
3. `getAll`에 review artifacts 포함.

## 7.3 SessionStore 확장
1. `budget` 상태 업데이트 메서드 추가.
2. `setArtifactRef(..., "review", artifactId)` 지원.
3. budget 이벤트 payload 기록 지원.

## 8. 파일 단위 구현 계획

## 8.1 신규 파일
1. `step5/src/agents/reviewerAgent.ts`
2. `step5/src/schemas/step5Artifacts.ts`
3. `step5/src/services/budgetTracker.ts`
4. `step5/tests/agents/reviewerAgent.test.ts`
5. `step5/tests/services/budgetTracker.test.ts`
6. `step5/tests/integration/step5-review-loop.test.ts`
7. `step5/tests/integration/step5-budget-exhausted.test.ts`
8. `docs/step5.md`

## 8.2 수정 파일
1. `step5/src/types.ts`
2. `step5/src/services/artifactStore.ts`
3. `step5/src/services/sessionStore.ts`
4. `step5/src/orchestrator/supervisor.ts`
5. `step5/src/server.ts`
6. `step5/src/serverApp.ts`
7. `step5/src/cli.ts`
8. `step5/public/index.html`
9. `step5/public/app.js`
10. `step5/public/styles.css`
11. `step5/README.md`
12. `plan.md` (동일 계획 동기화)

## 9. UI 상세 계획
1. Session Runner 입력 추가:
`maxIterations`, `maxMinutes`.
2. role 필터에 `reviewer` 추가.
3. `Review Summary` 섹션 추가:
latest artifact id, score, blocking/non-blocking count, fixPlan 요약.
4. `Budget Status` 섹션 추가:
iteration/remaining/deadline/elapsed 표시.
5. 이벤트 강조:
`review_blocking_detected`, `review_approved`, `budget_exhausted`.
6. Step5 프리셋 추가:
리뷰 승인, 리뷰 회귀 1회, 지속 blocking(예산 소진), 시간 소진, validation 실패 후 회복, legacy 입력 호환.

## 10. 테스트 계획

## 10.1 단위 테스트
1. ReviewerAgent 스키마 성공/실패.
2. BudgetTracker iteration/time 소진 판정.
3. ArtifactStore review 누적 저장/조회.
4. SessionStore budget/artifactRef/event 기록.

## 10.2 통합 테스트
1. validation pass + review approved -> success.
2. validation pass + review blocking -> implementation 회귀 -> success.
3. review blocking 반복 -> `failed_budget_exhausted(iterations)`.
4. 시간 예산 만료 -> `failed_budget_exhausted(minutes)`.
5. reviewer 런타임/스키마 오류 -> `phase_failed` + downstream skipped.

## 10.3 회귀 테스트
1. Step4 validation pipeline 관련 기존 테스트 유지.
2. `pnpm test` 전체 통과.
3. `pnpm build` 통과.
4. UI 세션 상태(watching 종료 포함) 회귀 확인.

## 11. 완료 기준 (DoD)
1. ReviewerAgent가 매 iteration 리뷰를 생성하고 ReviewArtifact가 저장된다.
2. blocking 이슈 시 자동으로 implementation으로 회귀한다.
3. 예산 초과 시 `failed_budget_exhausted` 종료가 재현된다.
4. session 상태/이벤트/UI에서 review와 budget 정보를 확인할 수 있다.
5. `maxAttempts` 하위호환이 유지된다.

## 12. 구현 순서
1. 타입/스키마 확장.
2. ReviewerAgent 구현 + 단위 테스트.
3. BudgetTracker 구현 + 단위 테스트.
4. ArtifactStore/SessionStore 확장.
5. Supervisor 루프 리팩터링(review 회귀 + budget 종료).
6. serverApp/CLI 입력 정규화 및 호환 처리.
7. UI 반영(입력/요약/이벤트/프리셋).
8. 통합/회귀 테스트 통과.
9. 문서 동기화.

## 13. 가정 및 기본값
1. blocking 판정 기준은 `blockingIssues`만 사용.
2. 기본 예산은 `maxIterations=6`, `maxMinutes=45`.
3. `maxAttempts`는 deprecated 호환 필드로 유지.
4. Step5의 packaging은 no-op 유지.
5. 저장소는 in-memory 유지(영속화는 Step7).

## 14. 모드 및 저장 규칙
1. 현재 Plan Mode이므로 파일 수정은 수행하지 않습니다.
2. 모드 전환 후 동일 내용으로 `plan-step5.md` 생성 및 루트 `plan.md` 덮어쓰기(AGENTS 규칙)를 수행합니다.
