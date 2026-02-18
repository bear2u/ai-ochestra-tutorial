# Step3 상세 개발 계획서 (완성본)

## 1. 요약
- 목표: `step3`에서 `planning -> architecture -> design`을 no-op이 아닌 **실제 에이전트 실행 단계**로 전환하고, 각 단계 산출물(artifact)을 생성/검증/저장/전달하도록 구현한다.
- 핵심 결과: `PlannerAgent`, `ArchitectAgent`, `DesignerAgent` + `ArtifactStore` + Supervisor 연결 + UI 가시성 보강.
- 호환성 원칙: Step2 API/CLI 입력(`task`, `filePaths`, `testCommand`, `maxAttempts`)은 유지하고 내부에서 `task -> topic` 매핑한다.
- 범위: Step3는 상위 3개 phase와 artifact 계약까지. Step4(ValidationPipeline/patch 우선)는 제외.

## 2. 현재 기준선
- `step3`는 사실상 `step2` 복사본 상태이며, 현재 차이는 의미 있는 코드 변경이 아닌 환경(`node_modules`) 수준.
- `planning/architecture/design`는 현재 no-op phase.
- UI는 `Phase Tracker`/프리셋/Live Event Stream이 있으나 role 필터는 `supervisor/dev/test`만 지원.

## 3. 범위 정의

### In Scope
1. `PlannerAgent`, `ArchitectAgent`, `DesignerAgent` 신규 구현.
2. artifact 타입 + Zod 스키마 정의:
- `PlanArtifact`
- `ArchitectureArtifact`
- `DesignArtifact`
3. `ArtifactStore`(세션 단위 in-memory 저장소) 구현.
4. Supervisor에서 planning->architecture->design 실행/검증/저장/이벤트 발행.
5. implementation phase에 상위 artifact context 전달.
6. UI 필수 보강:
- role 필터( planner/architect/designer )
- 신규 role 스타일
- `artifact_created`/`artifactId` 표시
- Step3 프리셋 갱신
7. 테스트(단위/통합/회귀)와 문서 정리.

### Out of Scope
1. `validationCommands[]` 파이프라인(`lint/typecheck/test`) 도입.
2. patch 기반 변경 적용 포맷 전환.
3. Reviewer/Packager 실구현.
4. artifacts 조회 전용 API 신규 공개.

## 4. 공개 인터페이스/타입 변경

### 4.1 `src/types.ts` 변경
1. `AgentRole` 확장:
- `"supervisor" | "dev" | "test" | "planner" | "architect" | "designer"`
2. artifact 타입 추가:
- `PlanArtifact`, `ArchitectureArtifact`, `DesignArtifact`, `Step3Artifact`(union)
3. `SessionState` 확장:
- `artifactRefs?: Partial<Record<"planning" | "architecture" | "design", string>>`
4. `SessionEvent` 확장:
- `artifactId?: string` (optional, 하위호환)

### 4.2 API 호환성
- 유지: `/api/health`, `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/events`
- 요청 스키마 유지: `task`, `filePaths`, `testCommand`, `maxAttempts`
- 응답 확장: optional 필드만 추가(`artifactRefs`, `artifactId`)하여 기존 클라이언트 무중단.

## 5. Artifact 계약 (결정 완료)

### 5.1 PlanArtifact
- `id`, `sessionId`, `phase:"planning"`, `topic`, `createdAt`
- `goals:string[]`
- `requirements:{id:string; description:string; priority:"must"|"should"|"could"}[]`
- `constraints:string[]`
- `assumptions:string[]`
- `doneCriteria:string[]`

### 5.2 ArchitectureArtifact
- `id`, `sessionId`, `phase:"architecture"`, `createdAt`
- `overview:string`
- `modules:{name:string; responsibility:string; files:string[]}[]`
- `decisions:{title:string; rationale:string; tradeoffs:string[]}[]`
- `risks:{risk:string; mitigation:string}[]`

### 5.3 DesignArtifact
- `id`, `sessionId`, `phase:"design"`, `createdAt`
- `components:{name:string; purpose:string; files:string[]}[]`
- `apis:{name:string; input:string; output:string; errors:string[]}[]`
- `dataModels:{name:string; fields:string[]}[]`
- `implementationChecklist:string[]`
- `testIdeas:string[]`

## 6. 런타임/데이터 플로우 설계

## 6.1 phase 실행 규칙
1. `planning`:
- PlannerAgent 실행 -> PlanArtifact 생성 -> 스키마 검증 -> ArtifactStore 저장 -> `artifact_created` 이벤트
2. `architecture`:
- 입력: PlanArtifact
- ArchitectAgent 실행 -> ArchitectureArtifact 생성/검증/저장/이벤트
3. `design`:
- 입력: PlanArtifact + ArchitectureArtifact
- DesignerAgent 실행 -> DesignArtifact 생성/검증/저장/이벤트
4. `implementation`:
- 기존 DevAgent 유지
- `feedback`에 `artifact context`(plan/architecture/design 요약) 프리픽스 주입
5. `validation`:
- 기존 Step2 규칙 유지 (`tests_passed`면 탈출, `tests_failed`면 iteration 증가)

## 6.2 실패 처리 규칙
1. `tests_failed`(명령 exitCode != 0):
- 기존처럼 재시도 루프 지속.
2. `phase_failed`(LLM 파싱 실패, Zod 검증 실패, 내부 예외):
- 해당 phase 즉시 failed.
- 남은 phase는 skipped 처리.
- 세션은 `failed`로 종료, `session_finished` 기록.
3. 실패 이벤트 payload:
- `type: "phase_failed"`
- `phase`, `artifactId?(존재 시)`, `data.errorMessage`, `data.errorType`.

## 6.3 ArtifactStore 계약
- `save(sessionId, artifact): void`
- `get(sessionId, phase): Step3Artifact | undefined`
- `getAll(sessionId): Step3Artifact[]`
- `getRefs(sessionId): { planning?: string; architecture?: string; design?: string }`

## 7. 파일 단위 구현 계획

### 7.1 신규 파일
1. `step3/src/agents/plannerAgent.ts`
2. `step3/src/agents/architectAgent.ts`
3. `step3/src/agents/designerAgent.ts`
4. `step3/src/services/artifactStore.ts`
5. `step3/src/schemas/step3Artifacts.ts`
6. `step3/tests/agents/plannerAgent.test.ts`
7. `step3/tests/agents/architectAgent.test.ts`
8. `step3/tests/agents/designerAgent.test.ts`
9. `step3/tests/services/artifactStore.test.ts`
10. `step3/tests/integration/step3-artifact-phases.test.ts`

### 7.2 수정 파일
1. `step3/src/types.ts`
2. `step3/src/services/sessionStore.ts`
- `setArtifactRef(sessionId, phase, artifactId)` 추가
- `pushEvent` options에 `artifactId` 추가
3. `step3/src/orchestrator/supervisor.ts`
- pre-loop phase executor를 실제 에이전트 호출로 교체
- artifact 생성/저장/refs 업데이트/이벤트 발행
- phase_failed 즉시 종료 경로 추가
4. `step3/src/server.ts`
- `ArtifactStore` 및 신규 에이전트 의존성 주입
5. `step3/src/serverApp.ts`
- `/api/sessions/:id` 응답에서 확장 상태 노출 확인(스키마 변경 없음)
6. `step3/src/cli.ts`
- 신규 role 이벤트 출력(필터링 없이 표시)
7. `step3/public/index.html`
- role 필터에 planner/architect/designer 추가
8. `step3/public/styles.css`
- 신규 role 색상 스타일 추가
9. `step3/public/app.js`
- 신규 role 필터 반영
- `artifactId` 표시
- Step3 중심 프리셋 갱신
10. `step3/README.md`
- “Step3 변경점 요약” 섹션 추가
11. `docs/step3.md`
- 본 계획 반영

## 8. UI 업데이트 상세 (Step3 필수)

1. Live Event Stream role 필터 확장
- `planner`, `architect`, `designer` 체크박스 추가 (기본 ON)
2. 이벤트 표시
- `artifact_created`일 때 라벨과 `artifactId`를 본문에 노출
- `phase_failed`는 경고 스타일(기존 색체계 내 강조)
3. presets 교체(10개 유지)
- 최소 4개를 Step3 검증용으로 변경:
  - planning artifact 생성
  - architecture artifact 생성
  - design artifact 생성
  - schema failure 유도 시나리오
4. Phase Tracker
- 구조 유지, status/current/iteration 중심 유지

## 9. 테스트 계획 (TDD)

## 9.1 단위 테스트
1. Planner/Architect/Designer
- 정상 JSON -> Zod 통과 -> artifact 반환
- 필수 필드 누락/타입 오류 -> 예외 발생
2. ArtifactStore
- save/get/getAll/getRefs 동작
- session 격리 보장
3. SessionStore
- `artifactRef` 업데이트 반영
- 이벤트 `artifactId` 기록 확인

## 9.2 통합 테스트
1. planning->architecture->design 순차 실행
- 각 단계 `agent_started`, `artifact_created`, `phase_completed` 확인
2. artifact 전달 검증
- architecture는 plan 입력 사용
- design은 plan+architecture 입력 사용
3. implementation 전달 검증
- DevAgent 입력 feedback에 artifact context 포함 확인
4. 실패 경로
- planner/architect/designer 스키마 실패 시 `phase_failed` + session failed + downstream skipped

## 9.3 회귀 테스트
1. 기존 `tests/serverApp.test.ts` 통과
2. 기존 `tests/supervisor.test.ts` 통과(필요 시 expectation만 업데이트)
3. `pnpm test` 전체 통과
4. `pnpm build` 통과

## 10. 완료 기준 (DoD)
1. 세션마다 plan/architecture/design artifact 3종 생성.
2. `session.artifactRefs`에 3개 id가 기록.
3. UI에서 planner/architect/designer 이벤트를 필터로 확인 가능.
4. `artifact_created` 이벤트에 artifactId 표시.
5. 스키마 실패 시 phase_failed와 세션 실패 경로 재현 가능.
6. Step2 대비 API 호환 유지 및 테스트 통과.

## 11. 구현 순서 (권장)
1. 타입/스키마 정의
2. 에이전트 3종 구현 + 단위 테스트
3. ArtifactStore 구현 + 단위 테스트
4. SessionStore 확장
5. Supervisor 연결(phase 실행/실패 규칙)
6. 통합 테스트 작성/통과
7. UI 필터/이벤트/preset 반영
8. README + `docs/step3.md` 업데이트
9. 최종 회귀(`pnpm test`, `pnpm build`)

## 12. 가정 및 기본값
1. `task`는 Step3에서도 유지하고 planner topic으로 내부 매핑.
2. ArtifactStore는 Step3에서 in-memory로만 구현.
3. 신규 artifacts API는 Step3에서 추가하지 않음.
4. LLM 출력은 `completeJsonObject` + Zod로 검증.
5. validation 명령은 기존 `testCommand` 단일 명령 유지.
6. 승인 정책/예산 정책 강화는 Step5 이후로 이관.

## 13. 모드/저장 규칙
- 현재는 Plan Mode이므로 파일 수정은 수행하지 않는다.
- 모드 전환 후 본 계획을 동일 내용으로:
1. `docs/step3.md` 덮어쓰기
2. AGENTS 규칙에 따라 루트 `plan.md`도 덮어쓰기
