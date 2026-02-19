# Step6 개발 계획서 (PR 패키지 + Supervisor Advisory 보조 도입)

## 1. 요약
1. 기준선은 현재 `plan.md`의 Step5 상태(리뷰 루프/예산 제어/packaging no-op)로 둡니다.
2. Step6 목표는 `packaging`을 실구현해 `PrPackageArtifact`를 생성하고, 파일로도 내보내는 것입니다.
3. 추가 확장으로 `Supervisor LLM advisory`를 보조 역할로 도입합니다.
4. advisory는 **결정권 없음** 원칙을 유지하고, 기존 Supervisor 규칙 기반 전이를 변경하지 않습니다.
5. 이번 계획에서 확정된 기본값:
- `autonomous`는 루프 제어가 아니라 **advisory 적용 on/off 토글**
- advisory 기본값은 `enabled`
- packaging 실패 시 세션은 `failed` 처리

## 2. 현재 기준선 확인
1. 현재 단계는 `step5`까지 존재하고 `step6` 디렉터리는 아직 없습니다.
2. 현재 phase는 `planning -> architecture -> design -> implementation -> validation -> review -> packaging`이며 packaging은 no-op입니다.
3. 현재 입력은 `task` 기반이고 Step5에서 `maxIterations/maxMinutes/maxAttempts(legacy)`를 지원합니다.
4. artifact 저장은 `ArtifactStore`(in-memory), 이벤트 저장은 `SessionStore`(in-memory)입니다.

## 3. 범위 정의

## In Scope
1. `step5` 복제 기반 `step6` 생성.
2. `PackagerAgent` 추가 및 `PrPackageArtifact` 생성.
3. packaging 단계에서 `.orchestra/sessions/<sessionId>/pr-package.json` 파일 출력.
4. API 추가:
- `GET /api/sessions/:id/artifacts`
- `GET /api/sessions/:id/pr-package`
5. Supervisor advisory 보조 에이전트 추가.
6. 입력 확장:
- `topic` 정식 지원
- `task` 하위호환 (`topic`으로 매핑)
- `autonomous`(advisory on/off 토글)
7. CLI 확장:
- `--topic`, `--files`, `--autonomous`
- `--task` 하위호환 유지
8. UI 확장:
- advisor/packager 이벤트 가시화
- PR package 요약 패널
- Step6 프리셋 추가
9. 테스트/문서/README 동기화.

## Out of Scope
1. 세션 영속화/복구(Step7).
2. cancel/timeout 제어 API 확장(Step7).
3. 운영 하드닝 정책(Step8).

## 4. 공개 인터페이스/타입 변경

## 4.1 `step6/src/types.ts`
1. `AgentRole` 확장:
- `"advisor"`, `"packager"` 추가
2. `SessionInput` 확장/호환:
- `topic?: string`
- `task?: string` (legacy alias)
- `autonomous?: boolean`
- 기존 `filePaths`, `testCommand`, `validationCommands`, `maxIterations`, `maxMinutes`, `maxAttempts` 유지
3. 내부 정규화 규칙:
- `effectiveTopic = topic?.trim() || task?.trim()`
- 내부 Supervisor 실행 시 `task`와 `topic` 모두 `effectiveTopic`으로 통일
- `effectiveAutonomous = autonomous ?? true`
4. `artifactRefs` 확장:
- `packaging?: string`
5. 신규 타입:
- `PrPackageArtifact`
- `SupervisorAdvice`
- `Step6Artifact = Step5Artifact | PrPackageArtifact`

## 4.2 `PrPackageArtifact` 계약
1. 필드:
- `id`, `sessionId`, `phase: "packaging"`, `iteration`, `topic`
- `title`, `body`
- `changedFiles: string[]`
- `testSummary: string`
- `reviewSummary: string`
- `riskNotes: string[]`
- `advisorNotes: string[]`
- `outputPath: string`
- `createdAt`
2. 보장:
- `changedFiles`는 최소 1개 이상(비어있으면 `session.input.filePaths`로 fallback)
- `title/body`는 빈 문자열 금지
- `outputPath`는 workspace root 하위 상대경로

## 4.3 `SupervisorAdvice` 계약 (advisory only)
1. 필드:
- `iteration: number`
- `focusSummary: string`
- `feedbackPatch: string[]`
- `riskNotes: string[]`
- `recommendedAction: "continue" | "rework" | "approve"`
- `confidence: number` (0~1)
2. 사용 규칙:
- `recommendedAction`은 로깅/설명용이며 phase 전이 판단에 사용하지 않음
- `feedbackPatch`만 다음 implementation feedback에 병합
- 스키마 실패/LLM 오류 시 no-op으로 계속 진행

## 5. API/CLI 계약 변경

## 5.1 `POST /api/sessions`
1. 입력 허용:
- `topic` 또는 `task` 중 최소 1개 필수
- `autonomous` optional (default `true`)
- 기존 필드 모두 유지
2. 하위호환:
- 기존 `task`만 보내도 동작
- 기존 `maxAttempts`만 보내도 동작
3. 검증:
- `testCommand` 또는 `validationCommands` one-of 유지

## 5.2 신규 API
1. `GET /api/sessions/:id/artifacts`
- 응답: `{ artifacts: Step6Artifact[], refs: artifactRefs }`
2. `GET /api/sessions/:id/pr-package`
- 성공: `{ prPackage: PrPackageArtifact }`
- 미생성: `404`

## 5.3 CLI
1. 신규 플래그:
- `--topic`
- `--autonomous true|false` (기본 true)
2. 기존 `--task`는 legacy로 허용하고 `--topic` 우선.
3. 세션 종료 시 `pr-package`가 생성되면 `outputPath`, `title` 출력.

## 6. 런타임 플로우 설계

## 6.1 상위 phase
1. `planning -> architecture -> design`은 Step5와 동일.

## 6.2 반복 루프 + advisory
1. iteration 시작 시 예산 검사.
2. `autonomous=true`면 advisor 호출:
- 입력: topic, iteration, 이전 feedback, 최신 validation/review 요약, budget snapshot, artifact refs
- 출력: `feedbackPatch`, `riskNotes` 수집
3. implementation feedback 생성:
- 기존 artifact context + 기존 feedback + advisor feedbackPatch
4. `implementation` 실행.
5. `validation` 실행.
6. validation 실패 시 기존 규칙대로 다음 iteration 진행.
7. validation 성공 시 `review` 실행.
8. review blocking이면 기존 규칙대로 다음 iteration 진행.
9. review approved면 루프 종료.

## 6.3 packaging 실구현
1. `runPackagingPhase`에서 `PackagerAgent` 호출.
2. 입력 데이터 구성:
- topic
- changedFiles(이벤트 `changes_applied.data.changedPaths` 집계)
- latest validation artifact summary
- latest review artifact summary
- advisor risk/advice 누적
- 핵심 phase timeline
3. `PrPackageArtifact` 생성 후 저장.
4. `.orchestra/sessions/<sessionId>/pr-package.json` 파일 출력.
5. `artifact_created(packaging)` 이벤트 기록.
6. packaging 실패 정책:
- 즉시 `phase_failed(packaging)` + session `failed`.

## 6.4 이벤트 계약 추가
1. advisory:
- `advisor_started`
- `advisor_suggested`
- `advisor_applied`
- `advisor_skipped` (`autonomous=false`)
- `advisor_error`
2. packaging:
- `pr_package_created`
- `pr_package_written`
3. 기존 phase_started/completed/failed/session_finished 계약 유지.

## 7. 서비스/에이전트 설계

## 7.1 `PackagerAgent`
1. 책임:
- structured JSON(`title/body/changedFiles/testSummary/reviewSummary/riskNotes/advisorNotes`) 생성
2. 동작:
- LLM JSON 우선
- 스키마 검증
- 실패 시 안전 fallback 본문 생성
3. 스키마:
- `step6/src/schemas/step6Artifacts.ts`에 정의

## 7.2 `SupervisorAdvisorAgent`
1. 책임:
- rework/진행 관점 보조 조언 생성
2. 안전장치:
- strict schema parse 실패 시 no-op
- timeout 시 no-op
- 오류는 이벤트로만 기록, 세션 실패로 승격하지 않음

## 7.3 `PrPackageWriter`
1. 책임:
- sessionId별 디렉터리 생성
- JSON pretty write
- 상대경로 반환
2. 출력 경로:
- `.orchestra/sessions/<sessionId>/pr-package.json`
3. 경로 안전:
- workspace root 밖 경로 금지

## 7.4 Store 확장
1. `ArtifactStore`:
- `packaging` artifact 저장/조회
- `getPrPackage(sessionId)` 추가
- `getAll` 순서 마지막에 packaging 포함
2. `SessionStore`:
- `artifactRefs.packaging` 지원
- 필요 시 `autonomous/topic` 정규화된 input 유지

## 8. 파일 단위 구현 계획

## 8.1 단계 생성
1. `step5`를 기준으로 `step6` 디렉터리 복제.
2. 복제 시 `node_modules`, `dist`, 캐시 제외.

## 8.2 신규 파일 (step6)
1. `step6/src/agents/packagerAgent.ts`
2. `step6/src/agents/supervisorAdvisorAgent.ts`
3. `step6/src/schemas/step6Artifacts.ts`
4. `step6/src/services/prPackageWriter.ts`
5. `step6/tests/agents/packagerAgent.test.ts`
6. `step6/tests/agents/supervisorAdvisorAgent.test.ts`
7. `step6/tests/services/prPackageWriter.test.ts`
8. `step6/tests/integration/step6-pr-package-output.test.ts`
9. `step6/tests/integration/step6-advisory-loop.test.ts`
10. `docs/step6.md`

## 8.3 수정 파일 (step6)
1. `step6/src/types.ts`
2. `step6/src/services/artifactStore.ts`
3. `step6/src/services/sessionStore.ts`
4. `step6/src/orchestrator/supervisor.ts`
5. `step6/src/serverApp.ts`
6. `step6/src/server.ts`
7. `step6/src/cli.ts`
8. `step6/public/index.html`
9. `step6/public/app.js`
10. `step6/public/styles.css`
11. `step6/README.md`
12. 루트 `README.md` (Step6 반영 상태 문구 갱신)

## 9. 테스트 계획

## 9.1 단위 테스트
1. `PackagerAgent`
- 정상 JSON 파싱
- 스키마 실패 fallback
- changedFiles/riskNotes 기본값 처리
2. `SupervisorAdvisorAgent`
- 정상 advice 생성
- 스키마 오류/timeout no-op
- `autonomous=false`일 때 skip 동작
3. `PrPackageWriter`
- 파일 출력 경로/내용 검증
- 디렉터리 자동 생성
- 경로 안전성 검증

## 9.2 통합 테스트
1. happy path:
- review 승인 후 packaging artifact 생성
- `pr-package.json` 파일 생성
2. advisory enabled:
- advisor 이벤트 발생
- feedbackPatch가 다음 iteration feedback에 반영
3. advisory disabled:
- advisor 이벤트가 `advisor_skipped`로 기록
- 루프/결과는 기존과 동일
4. packaging failure:
- `phase_failed(packaging)` + session failed
5. API:
- `/api/sessions/:id/artifacts` 반환 검증
- `/api/sessions/:id/pr-package` 200/404 검증
6. CLI:
- `--topic` 입력 성공
- `--task` legacy 호환
- `--autonomous` true/false 파싱 검증

## 9.3 회귀 테스트
1. Step5 핵심 루프(validation/review/budget) 회귀 없음.
2. `pnpm test` 전체 통과.
3. `pnpm build` 통과.

## 10. 완료 기준 (DoD)
1. topic 1건 입력으로 세션 성공 시 PR 패키지 artifact와 `pr-package.json`이 생성된다.
2. `/api/sessions/:id/artifacts`, `/api/sessions/:id/pr-package`로 결과 조회가 가능하다.
3. advisory는 활성화 시 피드백을 보강하지만, 비활성/오류 시에도 세션은 규칙 기반으로 안전 진행한다.
4. packaging 실패는 세션 실패로 일관 처리된다.
5. `task` legacy 입력과 기존 Step5 흐름이 깨지지 않는다.

## 11. 구현 순서
1. `step6` 디렉터리 복제 및 빌드/테스트 기준선 확보.
2. 타입/스키마(`PrPackageArtifact`, `SupervisorAdvice`) 추가.
3. `PackagerAgent` + `PrPackageWriter` 구현.
4. `ArtifactStore`/`SessionStore` packaging 확장.
5. `Supervisor` packaging phase 실구현.
6. `SupervisorAdvisorAgent` 연결 및 이벤트 계약 반영.
7. `serverApp` API 확장.
8. CLI/대시보드(`topic`, `autonomous`, package view, role filter) 반영.
9. 단위/통합/회귀 테스트 고정.
10. 문서(`step6/README.md`, `docs/step6.md`, 루트 README) 동기화.

## 12. 가정 및 기본값 (확정)
1. `autonomous`는 advisory 적용 토글이며 루프 횟수/phase 전이를 바꾸지 않는다.
2. advisory 기본값은 `true`.
3. packaging 실패는 session `failed`로 처리한다.
4. `task`는 Step6에서도 지원하며 내부적으로 `topic`으로 통일한다.
5. 저장소는 Step6에서도 in-memory 유지(영속화는 Step7).

## 13. 모드 및 저장 규칙
1. 현재 Plan Mode이므로 파일 수정/저장은 수행하지 않습니다.
2. 모드 전환 후 동일 내용으로 루트 `plan.md`를 덮어써서 동기화합니다.
