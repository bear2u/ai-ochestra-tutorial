# Step1부터 시작하는 완전 자율 멀티 에이전트 오케스트레이션 로드맵

## 요약
- 최종 목표는 `Supervisor`가 `기획 → 설계 → 디자인 → 개발 → 테스트 → 리뷰 → 패키징`을 **완전 자율**로 수행하는 구조입니다.
- 현재 `Step1`은 기준선, `Step2`부터 확장을 시작합니다.
- 모든 단계는 `stepN`을 복사해 `stepN+1`에서만 개발합니다.

## 단계 운영 원칙
1. 단계 생성 규칙: `stepN` 복사 후 `stepN+1`에서만 변경.
2. 복사 시 제외: `node_modules`, `dist`, 캐시/로그 산출물.
3. 이전 단계는 동결(회귀 기준선 유지).
4. 각 단계 완료 조건: `pnpm test` + 해당 단계 신규 테스트 통과.
5. 각 단계 `README.md`에 “이전 단계 대비 변경점” 섹션 유지.

## Step 구성 (Step1~Step8)

## Step1 (완료, 베이스라인 유지)
1. 2-agent 순차 오케스트레이션(Dev/Test + Supervisor + SSE) 유지.
2. 이 단계는 기능 확장 없이 회귀 기준으로 고정.

## Step2 (`step1` -> `step2`): 워크플로우 엔진 뼈대
1. `Supervisor`를 phase 기반 실행기 구조로 리팩터링.
2. `PhaseName` 추가: `planning`, `architecture`, `design`, `implementation`, `validation`, `review`, `packaging`.
3. `AgentRole` 확장: `planner`, `architect`, `designer`, `developer`, `tester`, `reviewer`, `packager`.
4. `SessionEvent`에 `phase`, `iteration` 필드 추가.
5. 기존 Dev/Test 동작은 `implementation/validation` phase에 매핑.

완료 기준:
1. phase 순서 실행과 phase 이벤트 기록 동작.
2. 기존 Step1 API 동작(health/sessions/events)은 회귀 유지.

## Step3 (`step2` -> `step3`): 기획/설계/디자인 에이전트 도입
1. `PlannerAgent`, `ArchitectAgent`, `DesignerAgent` 추가.
2. 각 에이전트 출력 스키마(Zod) 추가.
3. 아티팩트 계약 도입: `PlanArtifact`, `ArchitectureArtifact`, `DesignArtifact`.
4. `ArtifactStore` 도입(세션별 아티팩트 저장/조회).
5. `Supervisor`가 planning→architecture→design 산출물을 생성 후 구현 단계로 전달.

완료 기준:
1. 세션마다 3개 상위 아티팩트가 생성됨.
2. 스키마 실패 시 phase 실패 이벤트 기록.

## Step4 (`step3` -> `step4`): 개발/테스트 자동 루프 고도화
1. `DeveloperAgent` 입력을 상위 아티팩트 기반으로 변경.
2. 코드 적용 포맷을 patch 우선으로 전환(`changes[{path, patch, fallbackContent}]`).
3. `ValidationPipeline` 추가: `pnpm lint -> pnpm typecheck -> pnpm test`.
4. `TestAgent`가 각 명령 출력 요약 및 실패 원인 분류.
5. `ValidationArtifact` 생성.

완료 기준:
1. 구현-검증이 자동으로 1회 이상 수행.
2. 실패 시 원인 분류(`lint|type|test|runtime|unknown`)가 기록됨.

## Step5 (`step4` -> `step5`): 리뷰 에이전트 + 자율 재작업 루프
1. `ReviewerAgent` 추가, 출력 스키마: `blockingIssues`, `nonBlockingIssues`, `score`, `fixPlan`.
2. blocking issue가 있으면 `implementation` phase로 자동 회귀.
3. 자율 루프 제어 필드 추가: `maxIterations`, `maxMinutes`.
4. `Supervisor`가 예산 소진 시 안전 종료(`failed_budget_exhausted`).
5. `ReviewArtifact` 생성.

완료 기준:
1. 리뷰 차단 이슈 발생 시 자동 재작업 루프 동작.
2. 성공/예산초과 종료 경로 모두 재현 가능.

## Step6 (`step5` -> `step6`): PR 후보 패키지 생성
1. `PackagerAgent` 추가, 최종 산출물 `PrPackageArtifact` 생성.
2. 필수 필드: `title`, `body`, `changedFiles`, `testSummary`, `reviewSummary`, `riskNotes`.
3. API 추가: `GET /api/sessions/:id/artifacts`, `GET /api/sessions/:id/pr-package`.
4. CLI 확장: `--topic`, `--files`, `--autonomous`.
5. 최종 출력 파일: `.orchestra/sessions/<sessionId>/pr-package.json`.

완료 기준:
1. topic 1건 입력으로 PR 후보 패키지 생성.
2. 전체 phase 타임라인과 최종 패키지 연결 가능.

## Step7 (`step6` -> `step7`): 안정성/관측성 강화
1. 세션 영속화(파일 또는 SQLite) 도입.
2. 중단 복구(재시작 시 running 세션 복구 정책) 추가.
3. 메트릭 노출: phase latency, 실패 분류, 성공률.
4. timeout/cancel 제어 추가.
5. 대시보드/CLI에 진행률 및 현재 phase 표시 강화.

완료 기준:
1. 서버 재시작 후 세션 조회 가능.
2. 장시간 세션에서 timeout/cancel 동작 검증.

## Step8 (`step7` -> `step8`): 운영 하드닝
1. 명령 실행 안전정책 강화(allowlist + max runtime + 출력 상한).
2. 대규모 변경 방지 가드(`maxChangedFiles`, `maxPatchBytes`) 추가.
3. 비밀정보/민감패턴 검사(최소 룰셋) 추가.
4. dry-run 모드 추가(파일 미반영 시뮬레이션).
5. 운영 체크리스트 문서화 및 E2E 리허설 시나리오 고정.

완료 기준:
1. 안전 가드 우회 없이 자동 세션 완주.
2. dry-run과 실제 실행 결과 비교 검증 가능.

## 공개 API/타입 변경사항 (최종 상태 기준)
1. `SessionInput` 확장: `topic`, `filePaths`, `validationCommands[]`, `maxIterations`, `maxMinutes`, `autonomous`.
2. `SessionState` 확장: `currentPhase`, `phaseStatuses`, `iteration`, `artifactRefs`, `budget`.
3. `SessionEvent` 확장: `phase`, `iteration`, `artifactId`, `classification`.
4. 신규 API:
- `GET /api/sessions/:id/artifacts`
- `GET /api/sessions/:id/artifacts/:phase`
- `GET /api/sessions/:id/pr-package`
- `POST /api/sessions/:id/cancel`
5. 하위호환:
- `task` 입력은 `topic`으로 매핑(최소 Step6까지 유지).

## 테스트 케이스/시나리오
1. 단위: phase 전이 규칙, 스키마 검증, 실패 분류기, 예산 종료 조건.
2. 통합: planning→architecture→design→implementation→validation→review→packaging 전체 경로.
3. 통합: 리뷰 차단 이슈 발생 시 자동 회귀 및 재시도.
4. 통합: 예산 소진 시 안전 종료와 이벤트 기록.
5. E2E: topic 입력 후 `pr-package.json` 생성까지.
6. 회귀: 기존 Step1 API 및 SSE 동작 유지.
7. 장애: LLM 오류/명령 timeout/JSON 파싱 오류 시 복구 경로 검증.

## 가정 및 기본값
1. 실행 범위는 단일 로컬 리포지토리.
2. 승인 정책은 완전 자율(사람 승인 단계 없음).
3. 기본 검증 명령은 `pnpm lint`, `pnpm typecheck`, `pnpm test`.
4. 기본 예산은 `maxIterations=6`, `maxMinutes=45`.
5. 초기 저장소는 인메모리 + 파일 백업, Step7에서 영속 저장으로 확장.
6. 모든 신규 단계는 이전 단계 복사본에서만 작업.
