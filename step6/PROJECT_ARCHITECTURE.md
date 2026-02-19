# Project Architecture (step4)

`step4`는 Step3 pre-loop artifact 구조 위에 patch-first implementation + validation pipeline을 추가한 단계입니다.

## 핵심 구성

1. Orchestration
- `src/orchestrator/supervisor.ts`
- phase: `planning -> architecture -> design -> implementation -> validation -> review -> packaging`

2. Agents
- `PlannerAgent`, `ArchitectAgent`, `DesignerAgent`
- `DevAgent` (patch-first 변경 생성)
- `TestAgent` (요약 + 분류 보조)

3. Services
- `ArtifactStore`: plan/architecture/design + validation(iteration 누적)
- `WorkspaceService`: patch 적용 + fallback 적용
- `ValidationPipeline`: lint/type/test 순차 실행 + fail-fast
- `CommandRunner`: shell 명령 실행
- `SessionStore`: 세션/이벤트 상태 저장

4. UI/API
- `src/serverApp.ts`: 세션 생성/조회/SSE
- `public/app.js`: Session Runner + Phase Tracker + Validation Summary + Prompt/Event 로그

## Runtime Flow (Step4)

1. 세션 시작 시 pre-loop 3개 artifact를 생성합니다.
2. implementation에서 DevAgent가 patch-first 변경안을 생성합니다.
3. WorkspaceService가 patch를 적용하고 실패 시 fallbackContent로 반영합니다.
4. validation에서 ValidationPipeline이 명령을 순차 실행합니다.
5. 각 iteration마다 ValidationArtifact를 생성/저장하고 분류를 기록합니다.
6. validation 성공 시 post-loop(review/packaging) 후 종료, 실패 시 다음 iteration 재시도합니다.

## 분류 규칙

- `lint` 단계 실패 -> `lint`
- `type` 단계 실패 -> `type`
- `test` 단계 실패 -> `test`
- timeout/spawn/runtime 예외 -> `runtime`
- custom 단계 실패 -> TestAgent 보조 분류, 없으면 `unknown`

## 코드 맵

- `src/services/validationPipeline.ts`
- `src/services/patchApply.ts`
- `src/services/workspace.ts`
- `src/agents/devAgent.ts`
- `src/agents/testAgent.ts`
- `src/schemas/step4Artifacts.ts`
- `src/types.ts`
