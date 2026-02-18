# Step3 상세 개발 계획서 (적용본)

## 1) 목표
- `planning -> architecture -> design`을 no-op phase에서 실제 에이전트 실행 phase로 전환한다.
- 각 phase 산출물(artifact)을 스키마로 검증하고 세션 단위로 저장/전달한다.
- Step2 입력/출력 호환성을 유지한다.

## 2) 핵심 변경
- 신규 에이전트:
  - `PlannerAgent`
  - `ArchitectAgent`
  - `DesignerAgent`
- 신규 artifact 계약:
  - `PlanArtifact`
  - `ArchitectureArtifact`
  - `DesignArtifact`
- 신규 저장소:
  - `ArtifactStore` (in-memory, session 단위)
- Supervisor 확장:
  - pre-loop phase 실실행
  - `artifact_created`, `phase_failed` 이벤트 처리
  - implementation feedback에 artifact context 주입

## 3) 타입/API 호환성
- 유지:
  - `POST /api/sessions`
  - `GET /api/sessions/:id`
  - `GET /api/sessions/:id/events`
- 확장(하위 호환):
  - `AgentRole`: `planner|architect|designer` 추가
  - `SessionState.artifactRefs` 추가
  - `SessionEvent.artifactId` 추가

## 4) Artifact 스키마
### PlanArtifact
- `id`, `sessionId`, `phase:"planning"`, `topic`, `createdAt`
- `goals`, `requirements`, `constraints`, `assumptions`, `doneCriteria`

### ArchitectureArtifact
- `id`, `sessionId`, `phase:"architecture"`, `createdAt`
- `overview`, `modules`, `decisions`, `risks`

### DesignArtifact
- `id`, `sessionId`, `phase:"design"`, `createdAt`
- `components`, `apis`, `dataModels`, `implementationChecklist`, `testIdeas`

## 5) 실행/실패 규칙
- planning:
  - Planner 실행 -> PlanArtifact 생성/검증/저장 -> `artifact_created`
- architecture:
  - PlanArtifact 입력 -> ArchitectureArtifact 생성/검증/저장 -> `artifact_created`
- design:
  - Plan + Architecture 입력 -> DesignArtifact 생성/검증/저장 -> `artifact_created`
- implementation:
  - 기존 DevAgent 유지
  - artifact summary/context를 feedback에 prepend
- validation:
  - Step2와 동일하게 `tests_passed` 시 루프 탈출, `tests_failed` 시 iteration 증가

실패 처리:
- 테스트 실패(`tests_failed`)는 재시도 루프 유지
- phase 런타임/스키마 실패는 `phase_failed`로 즉시 종료
- 남은 phase는 `phase_skipped`, 세션은 `failed`로 종료

## 6) UI 반영 (Step3 필수)
- Live Event Stream role 필터 확장:
  - `planner`, `architect`, `designer` 추가
- 이벤트 표시 확장:
  - `artifactId` 표시
  - `phase_failed` 경고 스타일 강조
- Session presets 갱신(10개):
  - planning/architecture/design artifact 시나리오
  - schema failure probe 포함

## 7) 테스트 계획
### 단위
- Planner/Architect/Designer:
  - 정상 JSON -> artifact 생성
  - 필수 필드 누락/타입 오류 -> 예외
- ArtifactStore:
  - `save/get/getAll/getRefs`
  - 세션 격리
- SessionStore:
  - `setArtifactRef` 반영
  - 이벤트 `artifactId` 기록

### 통합
- planning -> architecture -> design 순차 실행
- agent_started / artifact_created / phase_completed 이벤트 확인
- implementation feedback에 artifact context 포함 확인
- schema/runtime failure 시 `phase_failed` + downstream skipped 확인

### 회귀
- `tests/serverApp.test.ts`
- `tests/supervisor.test.ts`
- `pnpm test`
- `pnpm build`

## 8) Step4 이관 항목 (Out of Scope)
- `validationCommands[]` 파이프라인
- patch 우선 적용 포맷
- Reviewer/Packager 실구현
- artifacts 조회 전용 API
