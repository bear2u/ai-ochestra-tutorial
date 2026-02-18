# Project Architecture (step1)

이 문서는 `step1`의 멀티 에이전트 오케스트레이션 구조를 Excalidraw 다이어그램 기준으로 요약합니다.

## Excalidraw

- MCP 체크포인트 ID: `4dcd963c2fcd41849d`
- 다이어그램 범위:
  - Clients: Web UI (`public/app.js`), CLI (`src/cli.ts`)
  - Core Orchestration: Fastify Server, SessionStore, Supervisor, DevAgent, TestAgent, WorkspaceService, CommandRunner
  - External/Runtime: OpenAiClient, OpenAI-compatible API, File System, Shell/Test Process

체크포인트를 기준으로 이어서 수정할 때는 `restoreCheckpoint`를 사용하면 됩니다.

```json
[{"type":"restoreCheckpoint","id":"4dcd963c2fcd41849d"}]
```

## Runtime Flow

1. Web UI가 `POST /api/sessions`로 작업을 생성하거나, CLI가 `Supervisor.start()`를 직접 호출합니다.
2. `Supervisor`는 세션 상태/이벤트를 `SessionStore`에 기록하면서 시도를 반복합니다.
3. `WorkspaceService.readFiles()`로 대상 파일을 읽고, `DevAgent`가 LLM 호출로 변경안을 생성합니다.
4. `WorkspaceService.applyChanges()`가 파일 시스템에 변경을 반영합니다.
5. `CommandRunner.run(testCommand)`가 테스트 명령을 실행하고 출력을 수집합니다.
6. `TestAgent`가 출력 요약/원인/다음 액션을 생성하고, 실패 시 해당 피드백으로 다음 시도를 진행합니다.

## Code Map

- `src/server.ts`: Fastify API + SSE 이벤트 스트림 + 정적 파일 서빙
- `src/cli.ts`: CLI 진입점, Supervisor 실행과 로그 출력
- `src/orchestrator/supervisor.ts`: 오케스트레이션 루프(재시도, 상태 전이, 이벤트 기록)
- `src/agents/devAgent.ts`: 코드 변경안(JSON) 생성
- `src/agents/testAgent.ts`: 테스트 결과 요약
- `src/services/sessionStore.ts`: 세션/이벤트 메모리 저장소
- `src/services/workspace.ts`: 안전 경로 검증 + 파일 read/write
- `src/services/commandRunner.ts`: 셸 명령 실행 + 출력 수집
- `src/llm/openaiClient.ts`: OpenAI 호환 API 래퍼

## Run Commands

```bash
cd step1
npm install
cp .env.example .env
npm run dev
```

CLI 실행 예시:

```bash
npm run cli -- --task "함수 버그 수정" --files "src/utils/json.ts" --test "npm test" --max-attempts 3
```
