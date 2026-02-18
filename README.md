## 0. 공통 운영 규칙
1. 단계 생성
- `cp -R stepN stepN+1` (또는 동일 효과의 복사)
- 제외: `node_modules`, `dist`, 캐시/로그

2. 공통 완료 검증
- `pnpm test`
- `pnpm build`
- 단계별 신규 테스트 통과

3. 문서 동기화
- 각 단계 `README.md`에 “이전 단계 대비 변경점” 업데이트
- 필요 시 `docs/stepN.md` 상세 설계 반영

---

## Step1 (기준선)
목표:
- 2-agent(Dev/Test) + Supervisor + SSE 기준선 유지

구현:
- 기능 추가 없이 회귀 기준으로 고정

검증:
- 기존 API(`/api/health`, `/api/sessions`, `/api/sessions/:id/events`) 동작 확인

---

## Step2
목표:
- phase 엔진 뼈대 도입 (`planning`~`packaging`)

핵심 구현:
1. `Supervisor`를 phase 실행 구조로 리팩터링
2. `implementation/validation`만 반복 루프(maxAttempts)
3. 타입 확장
- `PhaseName`, `phaseStatuses`, `iteration`
- `SessionEvent.phase`, `SessionEvent.iteration`

주요 파일:
- `step2/src/orchestrator/supervisor.ts`
- `step2/src/types.ts`
- `step2/src/services/sessionStore.ts`
- `step2/public/*` (Phase Tracker, Live Event Stream)

완료 기준:
1. phase 순서 이벤트 기록
2. Step1 API 회귀 없음

---

## Step3
목표:
- planning/architecture/design을 실제 에이전트 실행으로 전환
- artifact 생성/검증/저장/전달

핵심 구현:
1. 에이전트 추가
- `PlannerAgent`, `ArchitectAgent`, `DesignerAgent`
2. artifact 계약 + Zod 검증
- `PlanArtifact`, `ArchitectureArtifact`, `DesignArtifact`
3. 저장소 추가
- `ArtifactStore` (세션 단위 in-memory)
4. Supervisor 연결
- pre-loop 실실행
- `artifact_created`, `phase_failed` 이벤트
- implementation feedback에 artifact context 주입
5. UI 보강
- role 필터: `planner/architect/designer`
- 이벤트 `artifactId` 표시
- Step3 테스트 프리셋 10개

주요 파일:
- `step3/src/agents/*.ts`
- `step3/src/schemas/step3Artifacts.ts`
- `step3/src/services/artifactStore.ts`
- `step3/src/orchestrator/supervisor.ts`
- `step3/public/app.js`, `step3/public/index.html`, `step3/public/styles.css`

완료 기준:
1. 세션마다 상위 artifact 3종 생성
2. `session.artifactRefs` 기록
3. schema/runtime 실패 시 `phase_failed` + downstream `skipped`

---

## Step4
목표:
- 개발/검증 루프 고도화

핵심 구현:
1. Dev 입력을 상위 artifact 기반으로 고정
2. 변경 포맷 patch 우선 전환
- `changes[{ path, patch, fallbackContent }]`
3. `ValidationPipeline` 추가
- `pnpm lint -> pnpm typecheck -> pnpm test`
4. TestAgent 실패 원인 분류
- `lint|type|test|runtime|unknown`
5. `ValidationArtifact` 생성

주요 파일(예상):
- `step4/src/agents/devAgent.ts`
- `step4/src/agents/testAgent.ts`
- `step4/src/services/workspace.ts`
- `step4/src/orchestrator/supervisor.ts`

완료 기준:
1. 구현-검증 자동 루프 1회 이상 수행
2. 실패 분류가 이벤트/아티팩트에 기록

---

## Step5
목표:
- 리뷰 에이전트 + 자율 재작업 루프

핵심 구현:
1. `ReviewerAgent` 추가
- 출력: `blockingIssues`, `nonBlockingIssues`, `score`, `fixPlan`
2. blocking issue 발생 시 `implementation` 자동 회귀
3. 예산 필드 추가
- `maxIterations`, `maxMinutes`
4. 예산 소진 안전 종료
- `failed_budget_exhausted`
5. `ReviewArtifact` 생성

완료 기준:
1. 리뷰 차단 이슈 자동 재작업
2. 성공/예산초과 종료 경로 모두 재현

---

## Step6
목표:
- PR 후보 패키지 산출

핵심 구현:
1. `PackagerAgent` 추가
2. `PrPackageArtifact` 생성
- `title`, `body`, `changedFiles`, `testSummary`, `reviewSummary`, `riskNotes`
3. API 추가
- `GET /api/sessions/:id/artifacts`
- `GET /api/sessions/:id/pr-package`
4. CLI 확장
- `--topic`, `--files`, `--autonomous`
5. 파일 출력
- `.orchestra/sessions/<sessionId>/pr-package.json`

완료 기준:
1. topic 입력 1건으로 PR 패키지 생성
2. phase 타임라인과 최종 패키지 연결 가능

---

## Step7
목표:
- 안정성/관측성 강화

핵심 구현:
1. 세션 영속화(파일 또는 SQLite)
2. 재시작 복구 정책
3. 메트릭 노출
- phase latency, 실패 분류, 성공률
4. timeout/cancel 제어
5. 대시보드/CLI 진행률 표시 강화

완료 기준:
1. 서버 재시작 후 세션 조회/복구
2. 장시간 세션 timeout/cancel 검증

---

## Step8
목표:
- 운영 하드닝

핵심 구현:
1. 명령 실행 안전정책 강화
- allowlist, max runtime, 출력 상한
2. 변경량 가드
- `maxChangedFiles`, `maxPatchBytes`
3. 민감정보 패턴 검사
4. dry-run 모드
5. 운영 체크리스트 + E2E 리허설 시나리오 고정

완료 기준:
1. 안전 가드 하에서 자동 세션 완주
2. dry-run vs 실제 실행 비교 검증 가능

---

## 최종 타입/API 목표(누적)
1. `SessionInput`: `topic`, `filePaths`, `validationCommands[]`, `maxIterations`, `maxMinutes`, `autonomous`
2. `SessionState`: `currentPhase`, `phaseStatuses`, `iteration`, `artifactRefs`, `budget`
3. `SessionEvent`: `phase`, `iteration`, `artifactId`, `classification`
4. 추가 API:
- `GET /api/sessions/:id/artifacts`
- `GET /api/sessions/:id/artifacts/:phase`
- `GET /api/sessions/:id/pr-package`
- `POST /api/sessions/:id/cancel`
5. 하위 호환:
- `task`는 최소 Step6까지 `topic`으로 매핑

## 공통 테스트 시나리오(누적)
1. 단위: phase 전이, 스키마 검증, 실패 분류, 예산 종료
2. 통합: planning→architecture→design→implementation→validation→review→packaging
3. 통합: 리뷰 차단 이슈 자동 회귀
4. 통합: 예산 소진 안전 종료
5. E2E: topic -> `pr-package.json` 생성
6. 회귀: 기존 Step1 API/SSE 동작 유지
7. 장애: LLM 오류/timeout/JSON 파싱 오류 복구 경로
