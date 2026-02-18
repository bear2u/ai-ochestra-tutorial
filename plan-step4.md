# Step4 확장 개발 계획서 (Step3 -> Step4)

## 1. 요약
1. 목표: `step4`에서 구현/검증 루프를 Step3 대비 고도화한다.
2. 핵심 결과:
- `DeveloperAgent` 출력을 patch 우선 포맷으로 전환 (`changes[{path, patch, fallbackContent}]`)
- `ValidationPipeline` 도입 (`lint -> typecheck -> test`)
- `TestAgent` 단계별 요약 + 실패 분류(`lint|type|test|runtime|unknown`)
- `ValidationArtifact`를 iteration마다 생성/저장
3. 호환성 원칙:
- 기존 `task`, `filePaths`, `testCommand`, `maxAttempts` 입력은 계속 지원
- 신규 `validationCommands?: string[]` 추가
- 입력 규칙은 “`testCommand` 또는 `validationCommands` 중 하나 필수”

## 2. 현재 기준선 (확인 완료)
1. `step4`는 Step3 복사본 상태이며 pre-loop artifact 생성까지는 구현되어 있음.
2. 구현 적용은 아직 full-content 기반(`content`)이고 patch 우선 로직은 없음.
3. validation은 단일 `testCommand`만 실행.
4. UI 프리셋/문구는 Step3 기준으로 남아 있음.
5. `step4/package.json`에 `lint`, `typecheck` 스크립트가 없음.

## 3. 범위 정의

## In Scope
1. `validationCommands` 입력 도입(옵션) + 기존 `testCommand` 하위호환 유지.
2. patch 우선 적용 로직 구현(unified diff 적용 실패 시 `fallbackContent` 사용).
3. `ValidationPipeline` 서비스 신설 및 fail-fast 정책 적용.
4. 실패 분류 체계 추가: `lint|type|test|runtime|unknown`.
5. `ValidationArtifact` 스키마/저장/이벤트 연동.
6. UI 확장:
- Session Runner에 고급 입력 `Validation commands` 추가
- Validation 단계별 결과/분류 표시
- Step4용 프리셋 10개 교체
7. 테스트/문서 업데이트.

## Out of Scope
1. Reviewer/Packager 실구현 (Step5+).
2. 아티팩트 조회 전용 API 신규 공개 (Step6+).
3. 세션 영속화/복구 (Step7+).
4. 보안 하드닝(allowlist 강화, dry-run, 비밀검사) (Step8+).

## 4. 공개 인터페이스/타입 변경

## 4.1 `src/types.ts`
1. `FailureClassification` 추가:
- `"lint" | "type" | "test" | "runtime" | "unknown"`
2. `SessionInput` 확장:
- `testCommand?: string`
- `validationCommands?: string[]`
- 입력 규칙: 둘 중 하나 이상 필수
3. `FileChange`를 patch 우선 구조로 확장:
- `path: string`
- `patch?: string`
- `fallbackContent?: string`
- `content?: string` (레거시 호환용, Step4에서 deprecated)
4. `ValidationArtifact` 추가:
- `id`, `sessionId`, `phase:"validation"`, `iteration`, `createdAt`
- `passed`, `summary`, `classification?`
- `steps[]` (각 command 실행 결과)
5. `Step4Artifact` union 추가:
- `PlanArtifact | ArchitectureArtifact | DesignArtifact | ValidationArtifact`
6. `SessionState.artifactRefs` 확장:
- `validation?: string` (latest validation artifact id)
7. `SessionEvent` 확장:
- `classification?: FailureClassification`

## 4.2 API (`src/serverApp.ts`)
1. `POST /api/sessions` 요청 스키마 확장:
- `validationCommands?: string[]` 허용
- `testCommand`은 optional로 변경
- refine로 “`testCommand || validationCommands.length>0`” 강제
2. 기존 엔드포인트 유지:
- `/api/health`, `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/events`
3. 응답은 optional 필드 추가만 수행하여 하위호환 유지.

## 5. 계약(Contract) 상세

## 5.1 Patch 변경 계약
1. `changes` 각 항목은 unified diff 기준 `patch`를 우선 사용.
2. patch 적용 실패 시 `fallbackContent`가 있으면 해당 내용으로 파일 write.
3. `patch`, `fallbackContent`, `content` 모두 없거나 적용 실패 시 implementation phase 실패.

## 5.2 ValidationPipeline 계약
1. 입력:
- `task`, `iteration`, `validationCommands`
2. 기본 명령 해석:
- `validationCommands`가 있으면 그대로 사용
- 없으면 `["pnpm lint", "pnpm typecheck", testCommand]`
3. 실행 정책:
- 순차 실행
- 첫 실패에서 즉시 중단(fail-fast)
4. 분류 정책:
- 규칙기반 우선(실패한 stage 매핑)
- ambiguous/custom일 때 TestAgent 보조 분류
5. 출력:
- `ValidationArtifact` 1개(해당 iteration)
- 성공/실패, summary, classification 포함

## 5.3 ValidationArtifact 저장 계약
1. iteration마다 artifact 생성.
2. ArtifactStore에는 validation artifacts를 배열로 누적 저장.
3. SessionState에는 latest validation artifact id만 `artifactRefs.validation`으로 노출.

## 6. 런타임 플로우 설계

## 6.1 Implementation phase
1. Supervisor가 Step3 artifacts context를 DevAgent에 전달.
2. DevAgent는 patch 우선 결과를 반환.
3. WorkspaceService가 `applyChanges()`에서 patch 적용 시도.
4. 성공 시 `changes_applied` 이벤트 기록.
5. patch 실패 후 fallback 사용 시 `patch_fallback_applied` 이벤트 기록.
6. 치명적 실패 시 `phase_failed(implementation)`.

## 6.2 Validation phase
1. Supervisor가 effective validation commands를 계산.
2. ValidationPipeline이 명령을 순차 실행.
3. 각 명령마다 `validation_command_started/completed/failed` 이벤트 발행.
4. 실패 시 classification 결정 후 `ValidationArtifact` 생성.
5. artifact 저장 후 `artifact_created(phase=validation)` 발행.
6. 최종적으로 기존 호환 이벤트도 발행:
- 성공: `tests_passed`
- 실패: `tests_failed` + `classification` 포함

## 6.3 루프/종료
1. validation success면 review/packaging 진행 후 session success.
2. validation failed면 feedback 갱신 후 다음 iteration.
3. maxAttempts 소진 시 session failed + post-loop skipped.

## 7. 실패 처리 규칙
1. command spawn 오류/timeout/비정상 종료는 `runtime`.
2. lint 단계 실패는 `lint`, typecheck 단계 실패는 `type`, test 단계 실패는 `test`.
3. custom 단계 실패는 TestAgent 보조 분류 결과 사용, 없으면 `unknown`.
4. phase 런타임 예외는 기존 `phase_failed` 경로 유지.
5. 실패 분류는 `SessionEvent.classification` 및 artifact에 동시 기록.

## 8. 파일 단위 구현 계획

## 8.1 신규 파일
1. `step4/src/schemas/step4Artifacts.ts` (ValidationArtifact 스키마)
2. `step4/src/services/validationPipeline.ts`
3. `step4/src/services/patchApply.ts` (unified diff apply helper)
4. `step4/tests/services/validationPipeline.test.ts`
5. `step4/tests/services/patchApply.test.ts`
6. `step4/tests/integration/step4-validation-pipeline.test.ts`

## 8.2 수정 파일
1. `step4/src/types.ts`
2. `step4/src/services/artifactStore.ts`
3. `step4/src/services/sessionStore.ts`
4. `step4/src/services/workspace.ts`
5. `step4/src/services/commandRunner.ts`
6. `step4/src/agents/devAgent.ts`
7. `step4/src/agents/testAgent.ts`
8. `step4/src/orchestrator/supervisor.ts`
9. `step4/src/server.ts`
10. `step4/src/serverApp.ts`
11. `step4/src/cli.ts`
12. `step4/public/index.html`
13. `step4/public/app.js`
14. `step4/public/styles.css`
15. `step4/package.json` (scripts + deps)
16. `step4/README.md`
17. `step4/PROJECT_ARCHITECTURE.md`
18. `docs/step4.md` (신규)
19. `plan.md` (AGENTS 규칙 동기화)

## 9. 패키지/스크립트 결정
1. `step4/package.json` 스크립트 추가:
- `lint`
- `typecheck`
- `test`(기존 유지)
2. 기본 파이프라인은 `pnpm lint -> pnpm typecheck -> pnpm test`.
3. 필요시 lint 실행을 위해 eslint 계열 의존성/설정을 Step4에 포함.

## 10. UI 상세 계획
1. Session Runner에 `Validation commands` 입력(줄바꿈 또는 콤마 파싱) 추가.
2. `Test command` 입력은 유지(호환용).
3. Live Event Stream에 validation command 결과와 classification 강조 표시.
4. `Validation Summary` 섹션 추가:
- latest validation artifact id
- 단계별 command status
- 최종 classification
5. 프리셋 10개를 Step4 중심으로 교체:
- pipeline 성공
- lint 실패
- typecheck 실패
- test 실패
- runtime 실패
- custom command unknown 분류
- patch 성공
- patch fallback
- testCommand-only 호환
- validationCommands-only 입력

## 11. 테스트 계획

## 11.1 단위
1. `patchApply`:
- patch 성공 적용
- patch 실패 + fallback 적용
- 모두 실패 시 예외
2. `validationPipeline`:
- 3단계 모두 성공
- lint/type/test 각 단계 fail-fast
- runtime 오류 분류
- unknown 분류
3. `testAgent`:
- 단계별 summary 생성
- 규칙기반 + LLM 보조 분류 동작
4. `serverApp`:
- 입력 refine(`testCommand`/`validationCommands` one-of) 검증
5. `artifactStore/sessionStore`:
- validation artifact 누적 저장
- latest ref 및 event classification 기록

## 11.2 통합
1. pre-loop + implementation + validation pipeline 전체 성공 경로.
2. lint 실패 시 iteration 증가 + classification=lint.
3. type 실패 시 classification=type.
4. test 실패 시 classification=test.
5. runtime 실패(command error/timeout) 시 classification=runtime.
6. maxAttempts 소진 시 failed 종료 및 post-loop skipped.
7. iteration별 validation artifact 누적 생성 확인.

## 11.3 회귀
1. 기존 Step3 artifact flow 테스트 유지/갱신.
2. `pnpm test` 전체 통과.
3. `pnpm build` 통과.
4. 기존 UI 기능(세션 시작/이벤트 스트림/watching 종료) 유지.

## 12. 완료 기준 (DoD)
1. patch 우선 적용 + fallback 로직이 실제 실행됨.
2. validation이 파이프라인(3단계)으로 동작함.
3. 실패 시 분류값(`lint|type|test|runtime|unknown`)이 이벤트/artifact에 기록됨.
4. validation artifact가 iteration마다 생성되고 latest ref가 노출됨.
5. UI에서 validation 단계별 상태와 분류를 확인 가능함.
6. 기존 Step3 입력 방식으로도 세션 실행 가능함.

## 13. 구현 순서
1. 타입/스키마(`types.ts`, `step4Artifacts.ts`) 확장.
2. patch apply 유틸 + workspace 적용 로직 구현.
3. validationPipeline + testAgent 확장 구현.
4. supervisor에 implementation/validation 단계 연결.
5. sessionStore/artifactStore/event 확장.
6. serverApp/cli 입력 확장 및 호환 처리.
7. UI 입력/표시/프리셋 Step4 갱신.
8. 테스트 작성/보정 후 회귀 통과.
9. 문서(`README`, `PROJECT_ARCHITECTURE`, `docs/step4.md`) 업데이트.

## 14. 가정 및 기본값 (확정)
1. `validationCommands`는 optional, `testCommand`와 one-of 필수.
2. 기본 pipeline은 `lint -> typecheck -> test`.
3. 실패 시 즉시 중단(fail-fast).
4. patch 포맷은 unified diff + fallbackContent.
5. 분류는 규칙기반 우선 + LLM 보조.
6. validation artifact는 iteration마다 모두 저장, 세션에는 latest ref만 표시.
7. Step5 이상의 리뷰/패키징 실구현은 이번 범위에서 제외.

## 15. 모드/저장 규칙
1. 현재 Plan Mode이므로 파일 변경은 수행하지 않음.
2. 모드 전환 후 본 계획을 동일 내용으로 `docs/step4.md`와 루트 `plan.md`에 저장한다.
