# Step7 확장 개발 계획서 (Step6 기반)  
## 목표: “채팅 한 줄로 팀처럼 자동 개발” 구현

## 1. 요약
1. Step6를 기준선으로 `step7` 신규 폴더를 생성해 확장합니다.
2. 핵심 목표는 다음 3가지를 실제 기능으로 구현하는 것입니다.
3. 작업 분해 + 병렬 worker 에이전트 실행.
4. 자동 파일 탐색/대상 선정으로 `filePaths` 수동 의존 축소.
5. 에이전트 간 명시적 handoff 프로토콜(직접 협업 상태 모델) 도입.
6. 사용자 입력은 멀티턴 세션 채팅으로 받고, 세션 성공 시 코드 변경 + PR 패키지까지 자동 생성합니다.
7. Git 자동화는 이번 단계에서 제외하고(커밋/푸시 미자동), 승인 정책은 “부분 승인 모드 + install까지 자동”으로 고정합니다.

## 2. 의사결정 확정값
1. 실행 정책: 부분 승인 모드.
2. 명령 자동화 범위: install 포함 자동 실행.
3. 병렬 모델: phase 내부 병렬 worker.
4. 파일 탐색 범위: workspaceRoot 하위 전체 스캔.
5. 채팅 UX: 멀티턴 세션 채팅.
6. Git 자동화: 코드/PR 패키지까지만 자동, 커밋/푸시는 수동.
7. 코드 위치: `step7` 신규 폴더.

## 3. 범위 정의
### In Scope
1. 채팅 세션 기반 오케스트레이션 API/UI.
2. Task 분해/스케줄링/병렬 실행 엔진.
3. 자동 파일 탐색 및 대상 파일 점수화 선택.
4. handoff 상태 모델 + handoff 이벤트/로그/UI.
5. 승인 큐(Approval Queue) API/UI.
6. Step6 호환 입력/기존 API 유지.
7. 테스트/문서/README 동기화.

### Out of Scope
1. Git commit/push 자동화.
2. 외부 배포 자동화(vercel/deploy/publish).
3. 프로세스 재시작 후 영속 복구(이번 Step7 범위에서는 in-memory 유지).

## 4. 아키텍처 확장 설계
1. 상위 엔진을 `TeamOrchestrator`로 확장합니다.
2. `TeamOrchestrator`는 기존 `Supervisor`를 재사용하되, implementation phase 전에 TaskGraph를 만들고 병렬 worker를 운영합니다.
3. worker는 `DevAgent` 인스턴스를 task 단위로 다중 실행합니다.
4. 각 task는 파일 잠금(File Lock) 기반으로 충돌 없이 병렬 실행됩니다.
5. worker 간 전달은 handoff envelope로만 수행합니다.
6. supervisor는 handoff를 라우팅/검증만 하고, 협업 상태는 TaskGraphStore에 기록합니다.
7. validation/review/packaging의 최종 판정 규칙은 Step6 로직을 유지합니다.

## 5. 공개 인터페이스/타입 변경 (중요)
### 5.1 타입 (`step7/src/types.ts`)
1. `AgentRole` 확장: `"coordinator" | "worker" | "discoverer"` 추가.
2. `SessionStatus` 확장: `"waiting_approval"` 추가.
3. 신규 엔티티:
4. `ChatSession { id, workspaceRoot, status, createdAt, updatedAt, activeRunId?, lastSummary? }`
5. `ChatMessage { id, chatSessionId, role:user|system|assistant, content, createdAt, linkedRunId? }`
6. `TaskCard { id, runId, title, objective, phase, status, assignee, dependencies[], targetFiles[], acceptanceCriteria[], commands[], handoffRequired?, retries, createdAt, updatedAt }`
7. `HandoffEnvelope { id, runId, fromTaskId, toTaskId, reason, requiredArtifacts[], requiredChecks[], status, createdAt, resolvedAt? }`
8. `ApprovalRequest { id, runId, taskId?, command, reason, riskLevel, status:pending|approved|rejected, requestedAt, decidedAt?, decidedBy? }`
9. `DiscoveryArtifact { id, runId, workspaceRoot, candidates[], selectedFiles[], reasoning, createdAt }`
10. `TaskGraphArtifact { id, runId, tasks[], edges[], createdAt }`
11. 기존 `SessionInput`은 유지하되 `chatSessionId?: string`, `originMessageId?: string` 필드 추가.

### 5.2 API 계약
1. 기존 API 유지:
2. `POST /api/sessions`, `GET /api/sessions/:id`, `GET /api/sessions/:id/events` 유지.
3. 신규 Chat API:
4. `POST /api/chat/sessions` 생성.
5. 입력: `{ workspaceRoot?, autonomous?, maxIterations?, maxMinutes? }`
6. 응답: `{ chatSessionId }`
7. `POST /api/chat/sessions/:id/messages` 메시지 추가 + 실행 트리거.
8. 입력: `{ content: string }`
9. 응답: `{ runSessionId, chatSessionId }`
10. `GET /api/chat/sessions/:id` 채팅 상태/최근 run/요약 조회.
11. `GET /api/chat/sessions/:id/messages` 대화 이력 조회.
12. `GET /api/chat/sessions/:id/events` 채팅 레벨 SSE.
13. 신규 Task/Approval API:
14. `GET /api/sessions/:id/tasks` TaskCard 목록 + 상태.
15. `GET /api/sessions/:id/handoffs` Handoff 목록.
16. `GET /api/approvals/pending?runId=` 대기 승인 목록.
17. `POST /api/approvals/:id/decision` 입력 `{ decision: "approve"|"reject", note? }`.
18. `GET /api/sessions/:id/discovery` 자동 파일 탐색 결과 조회.

## 6. 실행 플로우 상세
1. 사용자 메시지 수신.
2. Intent 해석(`TaskDecomposerAgent`)으로 목표/완료조건/제약 추출.
3. `WorkspaceIndexer`가 workspace 전체 스캔 후 후보 파일 점수화.
4. `FileSelector`가 상위 후보를 선택해 DiscoveryArtifact 생성.
5. `TaskGraphBuilder`가 작업을 TaskCard/의존성 그래프로 분해.
6. `WorkerScheduler`가 의존성+파일잠금 기준으로 병렬 실행.
7. 각 worker는 패치/명령/검증결과를 TaskCard에 기록.
8. handoff 필요 시 HandoffEnvelope 생성 후 다음 task 큐에 전달.
9. 모든 task가 done이면 기존 validation/review/packaging 종료 파이프라인 실행.
10. 승인 필요 명령이 나오면 run 상태를 `waiting_approval`로 전환하고 승인 큐에 등록.
11. 승인/거절 후 해당 task를 재개하거나 실패 처리.
12. 최종 결과를 ChatSession 요약으로 반영하고 대화 이력에 assistant 메시지로 기록.

## 7. 자동 파일 탐색 설계
1. 스캔 범위: `workspaceRoot` 전체.
2. 제외 규칙: `.gitignore`, `node_modules`, `dist`, `.next`, `.orchestra`, 바이너리 파일.
3. 점수화:
4. 경로 직접 언급 +100.
5. 토픽 키워드-파일명 매칭 +40.
6. 프레임워크 힌트 매칭(예: Next.js -> `src/app`, `next.config`, `package.json`) +35.
7. 최근 변경 파일 +15.
8. 테스트 관련 파일 +20.
9. 선택 정책: 점수 상위 N(기본 12), 최소 신뢰도 미달 시 fallback core files(`package.json`, `README`, 엔트리 페이지).
10. 결과를 DiscoveryArtifact로 저장하고 UI에 노출.

## 8. 병렬 Worker + Handoff 프로토콜
1. Task 상태: `queued -> running -> review -> done | blocked | failed`.
2. 병렬도 기본값: `maxParallelWorkers=3`, 상한 5.
3. 파일잠금: 동일 파일을 건드리는 task는 동시 실행 금지.
4. handoff 규약:
5. worker는 직접 다른 worker에 전달할 `HandoffEnvelope`를 생성.
6. handoff에는 필요한 artifact/checklist/수락 조건 포함.
7. 수신 task가 `accepted` 전에는 실행 불가.
8. handoff 이벤트:
9. `handoff_created`, `handoff_accepted`, `handoff_rejected`, `handoff_completed`.
10. Supervisor는 라우팅/감사 추적만 수행하고 내용 결정은 worker가 담당.

## 9. 승인 정책 (부분 승인 + install 자동)
1. 자동 허용:
2. `pnpm|npm` 기반 설치/업데이트/add/remove/dlx/scaffold.
3. lint/type/test/build/dev script 실행.
4. 읽기성 명령(status/list/check).
5. 승인 필요:
6. 배포/퍼블리시/푸시 성격 명령(`publish`, `deploy`, `push`, `release` 등).
7. 파괴적 명령/히스토리 파괴(`reset --hard`, 대량 삭제성 스크립트 등).
8. 민감정보/환경변수 변경 명령.
9. 승인 거절 시 task는 `failed_policy_rejected`로 종료하고 대안 task를 재계획.

## 10. UI 확장 (`step7/public/*`)
1. 상단 멀티턴 Chat 패널.
2. Task Board(queued/running/review/blocked/done 칸반).
3. Worker 로그 패널(에이전트별 스트림).
4. Handoff 패널(요청/수락/완료 흐름).
5. Discovery 패널(선택 파일/점수/근거).
6. Approval Queue 패널(approve/reject 버튼).
7. 기존 Session Runner/Diagnostics는 유지하여 Step6 호환 시나리오도 실행 가능.

## 11. 파일 단위 구현 계획
### 11.1 신규 생성
1. `step7/src/orchestrator/teamOrchestrator.ts`
2. `step7/src/services/chatSessionStore.ts`
3. `step7/src/services/taskGraphStore.ts`
4. `step7/src/services/workerScheduler.ts`
5. `step7/src/services/workspaceIndexer.ts`
6. `step7/src/services/fileSelector.ts`
7. `step7/src/services/fileLockManager.ts`
8. `step7/src/services/approvalQueue.ts`
9. `step7/src/services/commandPolicy.ts`
10. `step7/src/agents/taskDecomposerAgent.ts`
11. `step7/src/agents/workerAgent.ts`
12. `step7/src/schemas/step7Artifacts.ts`
13. `step7/tests/services/workerScheduler.test.ts`
14. `step7/tests/services/workspaceIndexer.test.ts`
15. `step7/tests/services/approvalQueue.test.ts`
16. `step7/tests/integration/step7-chat-multiturn.test.ts`
17. `step7/tests/integration/step7-parallel-workers.test.ts`
18. `step7/tests/integration/step7-handoff-protocol.test.ts`
19. `step7/tests/integration/step7-approval-gate.test.ts`
20. `docs/step7.md`
21. `plan-step7.md`

### 11.2 수정
1. `step7/src/types.ts`
2. `step7/src/serverApp.ts`
3. `step7/src/server.ts`
4. `step7/src/orchestrator/supervisor.ts` (TaskGraph/worker 실행 지점 통합)
5. `step7/src/services/sessionStore.ts`
6. `step7/src/services/artifactStore.ts`
7. `step7/src/services/workspace.ts` (인덱서 연동 포인트)
8. `step7/src/services/commandRunner.ts` (approval policy hook)
9. `step7/public/index.html`
10. `step7/public/app.js`
11. `step7/public/styles.css`
12. `step7/README.md`
13. 루트 `README.md`

## 12. 테스트 계획
### 12.1 단위
1. Task 분해 결과 스키마/의존성 검증.
2. 파일 점수화/선택 정확성(Next/shadcn/todo 키워드 포함).
3. 스케줄러 병렬 실행 + 파일잠금 충돌 회피.
4. handoff 상태 전이 유효성.
5. 승인 큐 생성/승인/거절 흐름.
6. command policy 자동/승인 필요 분류 정확성.

### 12.2 통합
1. 멀티턴 채팅: 초기 지시 후 추가 수정 지시가 같은 chatSession에 누적 반영.
2. 병렬 worker: 독립 파일 task 동시 실행, 충돌 파일 순차 실행.
3. handoff 프로토콜: worker A -> worker B 전달 후 수락/완료.
4. 승인 게이트: 승인 대기 상태 진입/승인 후 재개/거절 후 재계획.
5. 자동 파일 탐색: `filePaths` 미입력에서도 적절 대상 선정.
6. 기존 Step6 API 호환: `/api/sessions` 경로 회귀 없음.
7. PR package 생성: 성공 종료 시 Step6와 동일한 산출 유지.

### 12.3 시나리오 E2E
1. “example에 NextJs16+shadcn 설치하고 Todo 칸반 생성” 단일 채팅 지시.
2. install 자동 실행 후 코드 생성/수정/검증/리뷰/패키징까지 완료.
3. 결과 파일: `src/app/page.tsx`, 관련 컴포넌트/스타일, 테스트/검증 로그, pr-package.

## 13. 완료 기준 (DoD)
1. 채팅 한 줄로 세션이 자동 시작되고 병렬 worker가 실제 작업한다.
2. `filePaths`를 명시하지 않아도 파일 탐색이 작동한다.
3. handoff가 독립 상태 모델/이벤트/UI로 확인 가능하다.
4. 승인 필요 명령은 큐에 들어가고 결정 후 재개된다.
5. 기존 Step6 인터페이스와 기본 흐름이 깨지지 않는다.
6. `pnpm test` 통과, `pnpm build` 통과(기존 known broken 파일 제외 시 원인 문서화 포함).

## 14. 구현 순서
1. `step6` 기준 `step7` 베이스 생성(의존성/테스트 기준선 확보).
2. 타입/스키마(채팅/태스크/handoff/승인) 추가.
3. ChatSessionStore + TaskGraphStore + ApprovalQueue 구현.
4. WorkspaceIndexer/FileSelector 구현.
5. WorkerScheduler + FileLockManager + WorkerAgent 병렬 실행 구현.
6. TeamOrchestrator로 supervisor 실행 경로 통합.
7. serverApp API 확장 + SSE 확장.
8. UI 채팅/태스크보드/handoff/approval/discovery 패널 구현.
9. 통합/E2E 테스트 고정.
10. 문서/README/plan-step7 동기화.

## 15. 가정 및 기본값
1. 저장소는 Step7에서도 in-memory(재시작 복구 미포함).
2. 기본 병렬도 `3`, 최대 `5`.
3. discovery topN 기본 `12`.
4. `autonomous=true` 기본 유지.
5. Git 자동화는 비활성(커밋/푸시 수동).
6. 승인 정책은 “install 자동, 배포/파괴적/민감 명령 승인 필요”.

## 16. 모드/저장 규칙
1. 현재 Plan Mode이므로 파일 수정/저장은 수행하지 않습니다.
2. 모드 전환 후 본 계획을 루트 `plan.md`에 overwrite 동기화합니다.
