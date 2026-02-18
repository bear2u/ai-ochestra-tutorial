# Agent Orchestration Lab (Step-by-step)

`step3`는 `step2`를 기반으로 상위 pre-loop phase(`planning/architecture/design`)를 실제 에이전트 실행으로 확장한 버전입니다.

## Step3 변경점 요약

- `PlannerAgent`, `ArchitectAgent`, `DesignerAgent`가 각각 `PlanArtifact`, `ArchitectureArtifact`, `DesignArtifact`를 생성합니다.
- `ArtifactStore`가 세션별 artifact를 저장하고, `SessionState.artifactRefs`로 참조를 노출합니다.
- `Supervisor`가 pre-loop phase를 no-op이 아닌 실제 실행으로 처리하고 `artifact_created` 이벤트를 발행합니다.
- implementation phase는 artifact context를 feedback에 주입해 dev agent 입력에 반영합니다.
- UI Live Event Stream에서 `planner/architect/designer` role 필터와 `artifactId` 표시를 지원합니다.

## Step2 변경점 요약

- `Supervisor`가 phase 엔진(`planning -> ... -> packaging`) 기반으로 동작합니다.
- `implementation`/`validation` phase만 `maxAttempts` 기준으로 반복합니다.
- 세션 상태에 `currentPhase`, `iteration`, `phaseStatuses`가 추가되었습니다.
- 세션 이벤트에 `phase`, `iteration` 메타데이터가 추가되어 SSE 추적성이 높아졌습니다.
- 성공/실패/회귀를 검증하는 `tests/supervisor.test.ts`가 추가되었습니다.

## 0) 설치/준비

```bash
cd step3
pnpm install
cp .env.example .env
```

기본 LLM 엔드포인트는 `OPENAI_BASE_URL=http://localhost:8000/v1`, 기본 모델은 `OPENAI_MODEL=gpt-5.3-codex` 입니다.
로컬 OpenAI 호환 서버를 쓰는 경우 `OPENAI_API_KEY=local-dev-key` 같은 임의 키로 실행 가능합니다.

## 1) 바닥부터 단계별 학습

### Step 1: Dev Agent만 보기

```bash
pnpm run study:1
```

학습 포인트:
- 에이전트가 파일 변경안(`changes`)을 어떻게 만드는지
- 변경 전/후를 어떻게 비교하는지

### Step 2: Dev + Test Agent 연결

```bash
pnpm run study:2
```

학습 포인트:
- dev 결과를 test 에이전트가 요약/판단으로 바꾸는 흐름
- 실패 로그를 다음 수정 근거로 쓰는 구조

### Step 3: Supervisor 재시도 루프

```bash
pnpm run study:3
```

학습 포인트:
- `attempt` 루프
- 실패 feedback을 dev 에이전트로 되돌리는 패턴
- `supervisor/dev/test` 역할 분리

### Step 4: 실제 서비스 결합

```bash
pnpm run study:4
```

학습 포인트:
- `WorkspaceService`로 실제 파일 쓰기
- `CommandRunner`로 실제 테스트 명령 실행
- `Supervisor`가 이벤트/상태를 관리하는 전체 사이클

## 2) 완성본 실행

### Web UI 서버

```bash
pnpm run dev
```

브라우저에서 `http://localhost:${PORT}` 접속 후 세션 생성 (`.env` 기본값 예: `3001`).

대시보드에서 바로 가능한 테스트:
- App health 점검 (`GET /api/health`)
- LLM 연결 ping (`POST /api/tools/llm/ping`)
- 로컬 테스트 명령 실행 (`POST /api/tools/command`)

### CLI

```bash
pnpm run cli -- --task "함수 버그 수정" --files "src/utils/json.ts" --test "pnpm test" --max-attempts 3
```

## 3) 코드 맵

- `src/agents/devAgent.ts`: 코드 변경 생성
- `src/agents/testAgent.ts`: 테스트 출력 요약/진단
- `src/orchestrator/supervisor.ts`: 루프 제어, 이벤트/상태 관리
- `src/services/workspace.ts`: 파일 읽기/쓰기
- `src/services/commandRunner.ts`: 테스트 명령 실행
- `src/services/sessionStore.ts`: 세션/이벤트 저장
- `src/study/*`: 학습용 단계 실행 코드
