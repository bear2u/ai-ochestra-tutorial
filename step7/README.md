# Agent Orchestration Lab (Step7)

`step7`는 `step6`를 확장해, 채팅 한 줄 지시로 팀 오케스트레이션을 실행하는 단계입니다.

## Step7 핵심 기능

- `TeamOrchestrator` 추가
  - 채팅 메시지 수신 후 run 세션 생성
  - 자동 파일 탐색(Discovery) -> 작업 분해(TaskGraph) -> 병렬 Worker 실행
  - 완료 후 기존 Step6 supervisor(`validation -> review -> packaging`)로 연결
- 역할/상태 확장
  - 역할: `coordinator`, `worker`, `discoverer`
  - 세션 상태: `waiting_approval`
- 승인 큐(Approval Queue)
  - 명령 정책 분류: `allow | approval | reject`
  - 승인 필요 시 `waiting_approval`로 전환, 승인 후 재개
  - UI에서 Approval Mode 선택 가능:
    - `manual`: approval 명령은 수동 승인
    - `auto_safe`: low/medium 자동승인, high 수동
    - `auto_all`: approval 명령 전체 자동승인
- 협업 상태 모델
  - `TaskCard`, `HandoffEnvelope`, `DiscoveryArtifact`, `TaskGraphArtifact`
  - API/UI에서 task/handoff/discovery/approval 상태 추적
- Step6 호환 유지
  - 기존 `/api/sessions` 기반 실행과 PR package 산출은 그대로 동작

## Step7 API

기존 Step6 API + 아래 API가 추가됩니다.

- `POST /api/chat/sessions`
- `GET /api/chat/sessions/:id`
- `GET /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages`
- `GET /api/chat/sessions/:id/events` (SSE)
- `GET /api/sessions/:id/tasks`
- `GET /api/sessions/:id/handoffs`
- `GET /api/sessions/:id/discovery`
- `GET /api/approvals/pending?runId=...`
- `POST /api/approvals/:id/decision`

## UI

- Quick Topic Run은 Step7 채팅 오케스트레이션 경로로 실행됩니다.
- 신규 패널:
  - Chat Orchestration
  - Task Board
  - Handoffs
  - Discovery
  - Approval Queue
  - Worker Logs

## 자동 Run 로그 저장

- Step7은 주요 실패/중단/종료 이벤트에서 run 스냅샷을 자동 저장합니다.
- 저장 경로:
  - `step7/.orchestra/run-logs/index.json`
  - `step7/.orchestra/run-logs/<runId>/latest.json`
  - `step7/.orchestra/run-logs/<runId>/<timestamp>-<trigger>.json`
- 스냅샷에는 `session/events/tasks/handoffs/discovery/approvals/artifacts/chat`이 포함됩니다.

최근 로그 빠른 확인:

```bash
ls -t .orchestra/run-logs/*/*.json | head -n 1
cat .orchestra/run-logs/index.json | head -n 40
```

## 실행

```bash
cd step7
pnpm install
cp .env.example .env
pnpm dev
```

브라우저: `http://localhost:${PORT}`

## 검증

```bash
pnpm typecheck
pnpm test
pnpm build
```
