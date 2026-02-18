# Step1 튜토리얼: 2-에이전트 오케스트레이션 완전 정복

> 이 튜토리얼은 step1 코드를 처음 접하는 개발자가 **실습을 통해** 2-에이전트 오케스트레이션을 완전히 이해할 수 있도록 설계되었습니다. 순서대로 진행하시고, 각 단계에서 "직접 해보세요" 섹션을 반드시 실행해 보세요.

---

## 튜토리얼 개요

### 이 튜토리얼을 끝내면 당신은:

- 2-에이전트 오케스트레이션의 전체 플로우를 설명할 수 있다
- API를 직접 호출하여 세션을 실행할 수 있다
- Supervisor, DevAgent, TestAgent의 역할을 구분할 수 있다
- 문제가 발생했을 때 어디를 고쳐야 할지 알 수 있다

### 예상 소요 시간: 30분

### 사전 준비물

```bash
# 1. 프로젝트 클론 및 설치
cd sample1/step1
pnpm install

# 2. 환경설정
cp .env.example .env

# 3. .env 파일에 OPENAI_API_KEY 설정
# (로컬 wrapper 사용 시 임의 문자열 가능)
```

---

## 1단계: 시스템 이해하기 (5분)

### 1.1 핵심 개념: 2-에이전트 오케스트레이션이란?

이 시스템을 한 문장으로 요약하면:

> **Supervisor가 DevAgent와 TestAgent를 순차적으로 지휘하여 코드를 자동으로 수정하고 검증하는 실험 환경**

각 에이전트의 역할을 그림으로 이해해 보세요:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Supervisor (감독자)                         │
│  • 세션 관리: 시작, 상태 전환, 종료                              │
│  • 재시도 루프: 실패 시 feedback으로 다음 시도 구성             │
│  • 이벤트 기록: 모든 과정을 SessionStore에 저장                 │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
    ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
    │ DevAgent │         │TestAgent│         │Session  │
    │ (개발자) │         │ (테스터) │         │ Store   │
    └─────────┘         └─────────┘         └─────────┘
         │                    │
         ▼                    ▼
    ┌─────────┐         ┌─────────┐
    │ 파일 변경│         │ 출력 분석│
    └─────────┘         └─────────┘
```

### 1.2 에이전트별 역할 상세

| 에이전트 | 입력 | 출력 | 비고 |
|---------|------|------|------|
| **DevAgent** | task + filePaths + feedback | `{rationale, changes: [{path, content}]}` | JSON 형태로 변경안 생성 |
| **TestAgent** | task + exitCode + commandOutput | `{summary, exitCode, commandOutput}` | 실패 원인을 요약 |
| **Supervisor** | SessionInput | 세션 상태 + 이벤트 | Dev → Test 루프orchestration |

### 📝 이해 확인 체크포인트

- [ ] Supervisor가 DevAgent와 TestAgent 중 어떤 것을 먼저 호출할까?
- [ ] 테스트가 실패하면 feedback은 어디로 갈까?
- [ ] success 상태는 언제 설정될까?

---

## 2단계: 서버 실행하고 API 확인하기 (5분)

### 2.1 서버 시작하기

```bash
cd step1
pnpm dev
```

서버가 정상적으로 시작되면 다음과 같은 메시지가 표시됩니다:

```
➜  Local:   http://localhost:3001/
➜  Network: http://192.168.1.100:3001/
```

> 기본 포트는 3001입니다 (.env에서 변경 가능)

### 2.2 API 직접 호출해보기

새 터미널을 열고 다음 명령어를 하나씩 실행해 보세요:

**1단계: 헬스 체크**

```bash
curl -s http://localhost:3001/api/health
```

**예상 결과:**
```json
{"ok":true}
```

**2단계: 설정 정보 확인**

```bash
curl -s http://localhost:3001/api/tools/overview | jq
```

**예상 결과:**
```json
{
  "ok": true,
  "service": "agent-orchestration-lab",
  "port": 3001,
  "model": "gpt-4.1-mini",
  "openaiBaseUrl": "http://localhost:8000/v1",
  "workspaceRoot": "/path/to/step1",
  "now": "2024-01-15T10:30:00.000Z"
}
```

**3단계: LLM 연결 테스트**

```bash
curl -s -X POST http://localhost:3001/api/tools/llm/ping \
  -H 'Content-Type: application/json' \
  -d '{"prompt": " Respond with exactly: pong"}' | jq
```

**예상 결과 (성공 시):**
```json
{
  "ok": true,
  "latencyMs": 1500,
  "output": "pong"
}
```

### 🎯 직접 해보세요 #1

1. 위의 3개 API를 순서대로 호출해 보세요
2. `/api/tools/overview`에서 자신의 환경설정 값을 확인하세요
3. LLM ping이 실패하면 `.env` 파일의 API 키를 확인하세요

---

## 3단계: 웹 UI 사용하기 (5분)

### 3.1 브라우저에서 열기

http://localhost:3001/ 를 브라우저에서 엽니다.

화면 구성을 확인하세요:

```
┌────────────────────────────────────────────────────────────┐
│                    Step1 Dashboard                         │
├────────────────────────────────────────────────────────────┤
│  [Settings]          │  Session Runner                     │
│  ───────────────────│  ───────────────────────────────────│
│  Model: gpt-4.1-mini │  Task: [                           ]│
│  API URL: localhost  │            ]                       │
│                      │                                     │
│                     │  Files: [                           ]│
│                     │            ]                       │
│                     │                                     │
│                     │  Test: [pnpm test           ]       │
│                     │                                     │
│                     │  Max Attempts: [3]                   │
│                     │                                     │
│                     │  [Start Session]                     │
├────────────────────────────────────────────────────────────┤
│  Events Log                                                │
│  ─────────────────────────────────────────────────────────│
│  (SSE를 통해 실시간 업데이트됩니다)                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.2 첫 번째 세션 실행하기

아래 값으로 입력해 보세요:

| 필드 | 값 |
|------|-----|
| **Task** | `extractJsonObject가 fenced json과 bare json을 모두 안정적으로 파싱하도록 개선` |
| **Files** | `src/utils/json.ts,tests/json.test.ts` |
| **Test** | `pnpm test` |
| **Max Attempts** | `3` |

"Start Session" 버튼을 클릭하면:

1. 우측 상단의 Session Runner에 세션 ID가 표시
2. Events Log에 실시간으로 이벤트가 streaming
3. 각 attempt마다 `dev → test` 플로우 확인

### 🎯 직접 해보세요 #2

1. 브라우저에서 http://localhost:3001/ 열기
2. 위의 입력값으로 세션 시작
3. Events Log에서 다음 이벤트 순서 확인:
   - `session_started`
   - `attempt_started`
   - `dev: agent_started`
   - `dev: changes_applied`
   - `test: agent_started`
   - `test: tests_passed` 또는 `test: tests_failed`

---

## 4단계: CLI로 실행하기 (3분)

### 4.1 CLI 명령어

웹 UI 대신 CLI로 실행하려면:

```bash
cd step1
pnpm cli -- \
  --task "extractJsonObject 안정화" \
  --files "src/utils/json.ts,tests/json.test.ts" \
  --test "pnpm test" \
  --max-attempts 3
```

### 4.2 출력 예시

```
🎯 Starting session...
📋 Session ID: sess_abc123

📝 Attempt 1/3
  👨‍💻 DevAgent: 파일 변경 생성 중...
  ✅ Changes applied: 2 files
  🧪 TestAgent: 테스트 결과 분석 중...
  ❌ Tests failed (exit code: 1)

📝 Attempt 2/3
  👨‍💻 DevAgent: 피드백 적용하여 수정 중...
  ✅ Changes applied: 1 files
  🧪 TestAgent: 테스트 결과 분석 중...
  ✅ Tests passed!

🎉 Success on attempt 2!
```

### 🎯 직접 해보세요 #3

CLI로 한 번 실행해 보고 웹 UI와 어떤 차이가 있는지 확인하세요.

---

## 5단계: 코드 아키텍처 분석하기 (7분)

### 5.1 프로젝트 구조 이해

```
step1/src/
├── server.ts           # 🏗️ 의존성 조립 (Composition Root)
├── serverApp.ts        # 🌐 HTTP API 라우터
├── config.ts           # ⚙️ 설정 관리
├── cli.ts              # 💻 CLI 인터페이스
├── types.ts            # 📝 타입 정의
│
├── agents/
│   ├── devAgent.ts     # 📝 코드 변경안 생성
│   └── testAgent.ts    # 📊 테스트 결과 분석
│
├── llm/
│   └── openaiClient.ts # 🤖 LLM 통신 클라이언트
│
├── orchestrator/
│   └── supervisor.ts   # 🎯 오케스트레이션 핵심
│
├── services/
│   ├── workspace.ts    # 📁 파일 시스템 접근
│   ├── commandRunner.ts# 🖥️ 명령어 실행
│   └── sessionStore.ts # 💾 상태/이벤트 저장
│
└── study/
    ├── step1-dev-agent.ts
    ├── step2-dev-test-agent.ts
    ├── step3-supervisor-loop.ts
    └── step4-supervisor-with-services.ts
```

### 5.2 Composition Root: server.ts

`server.ts`는 모든 의존성을 조립하는 핵심 파일입니다:

```typescript
// step1/src/server.ts (개념도)
const store = new SessionStore();              // 상태 저장소
const workspace = new WorkspaceService();       // 파일 서비스
const llm = new OpenAiClient();                // LLM 클라이언트
const commandRunner = new CommandRunner();      // 명령 실행기

// 에이전트 생성
const devAgent = new DevAgent(llm);
const testAgent = new TestAgent(llm);

// 감독자 생성 (모든 것을 연결)
const supervisor = new Supervisor(
  store,
  workspace,
  devAgent,
  testAgent,
  commandRunner
);

// 앱 빌드
const app = buildApp({ store, supervisor, llm, commandRunner });
```

### 5.3 Supervisor 루프 상세 분석

`supervisor.ts`의 핵심 루프를 살펴보세요:

```typescript
// step1/src/orchestrator/supervisor.ts:54-109

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // 1. 파일 읽기
  const files = await workspace.readFiles(filePaths);

  // 2. DevAgent에게 변경안 요청
  const devOutput = await devAgent.propose({ task, files, feedback });

  // 3. 변경사항 적용
  await workspace.applyChanges(devOutput.changes);

  // 4. 테스트 명령 실행
  const commandResult = await commandRunner.run(testCommand);

  // 5. TestAgent에게 분석 요청
  const evaluation = await testAgent.evaluate({
    task,
    exitCode: commandResult.exitCode,
    commandOutput: commandResult.output
  });

  // 6. 성공 여부 확인
  if (commandResult.exitCode === 0) {
    // ✅ 성공! 루프 종료
    return;
  }

  // ❌ 실패: 다음 시도를 위한 피드백 구성
  feedback = `Attempt ${attempt} failed.\n${evaluation.summary}`;
}
```

### 📝 이해 확인 체크포인트

- [ ] 왜 DevAgent를 먼저 호출하고 TestAgent를 나중에 호출할까?
- [ ] feedback 변수는 언제 초기화되고 언제 업데이트될까?
- [ ] 성공 시 for 루프에서 어떻게 탈출할까?

---

## 6단계: 핵심 서비스 심층 분석 (5분)

### 6.1 WorkspaceService: 파일 안전하게 읽고 쓰기

보안상 가장 중요한 파일 경로 검증 로직:

```typescript
// step1/src/services/workspace.ts:15-25
resolveSafePath(relativePath: string): string {
  // 1. 앞의 슬래시 제거
  const cleaned = relativePath.replace(/^\/+/, "");

  // 2. 절대경로로 변환
  const absolute = path.resolve(this.root, cleaned);

  // 3. 워크스페이스 외부 경로 차단 (Path Traversal 방지)
  if (!isInside(absolute, this.root)) {
    throw new Error(`Unsafe path rejected: ${relativePath}`);
  }

  return absolute;
}
```

> ⚠️ 중요: 이 검사를 통과하지 못하면 요청이 거부됩니다.

### 6.2 CommandRunner: 테스트 명령 실행

```typescript
// step1/src/services/commandRunner.ts:30-45
const child = spawn(command, {
  cwd: config.workspaceRoot,  // 워크스페이스 디렉토리에서 실행
  shell: true,
  env: process.env            // 환경변수 상속
});

// 출력 제한: 로그 폭주 방지
const output = combined.slice(-config.maxCommandOutputChars);
resolve({ exitCode: code ?? 1, output });
```

### 6.3 SessionStore: 상태 관리 + 실시간 푸시

```typescript
// step1/src/services/sessionStore.ts
private readonly sessions = new Map<string, SessionState>();
private readonly events = new Map<string, SessionEvent[]>();
private readonly emitter = new EventEmitter();

// SSE 구독
subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
  const channel = `session:${sessionId}`;
  this.emitter.on(channel, handler);
  return () => this.emitter.off(channel, handler);
}
```

### 6.4 API 보안: 명령어 검증

서버는 안전하지 않은 명령어를 차단합니다:

```typescript
// step1/src/serverApp.ts:43-48
const hasUnsafeShellChars = (command: string): boolean =>
  /[;&|><`$]/.test(command);

const isCommandAllowed = (command: string): boolean => {
  const normalized = command.trim();
  // pnpm/npm 명령만 허용
  return /^(pnpm|npm)\s+/i.test(normalized) && !hasUnsafeShellChars(normalized);
};
```

### 🎯 직접 해보세요 #4

다음 명령이 허용되는지 예측해 보고, 실제로 테스트해 보세요:

| 명령 | 예측 (Allowed/Rejected) | 실제 결과 |
|------|----------------------|----------|
| `pnpm test` | ? | ? |
| `npm run build` | ? | ? |
| `pnpm test & echo hello` | ? | ? |
| `cat /etc/passwd` | ? | ? |

---

## 7단계: 데이터 모델 이해하기 (3분)

### 7.1 SessionInput: 세션 입력값

```typescript
// step1/src/types.ts
interface SessionInput {
  task: string;           // 🎯 수행할 작업 (필수)
  filePaths: string[];   // 📁 수정할 파일 목록 (필수)
  testCommand: string;   // 🧪 검증 명령 (필수)
  maxAttempts: number;   // 🔄 최대 시도 횟수 (기본값: 3)
}
```

### 7.2 SessionState: 세션 상태

```typescript
interface SessionState {
  id: string;            // 고유 ID (예: sess_abc123)
  status: "pending" | "running" | "success" | "failed";
  input: SessionInput;
  attempt: number;       // 현재 시도 횟수
  startedAt: string;     // ISO timestamp
  endedAt?: string;      // 종료 시간
  finalSummary?: string; // 최종 결과 요약
}
```

### 7.3 SessionEvent: 실시간 이벤트

```typescript
interface SessionEvent {
  sessionId: string;
  role: "supervisor" | "dev" | "test";
  type: string;          // 예: "session_started", "changes_applied"
  message: string;
  data?: Record<string, unknown>; //附加 데이터
  timestamp: string;
}
```

### 📝 이해 확인 체크포인트

- [ ] `status: "running"` 상태에서는 어떤일이 벌어지고 있을까?
- [ ] 세션이 성공한 후, endedAt은 언제 설정될까?
- [ ] Events와 SessionState의 차이점은 무엇일까?

---

## 8단계: JSON 파서 안정화 기법 (3분)

### 8.1 문제 상황

LLM은 때때로 Markdown 코드 블록이나 불완전한 JSON을 반환합니다:

```markdown
여기 있습니다:

```json
{"rationale": "테스트", "changes": []}
```

### 8.2 해결 방법: extractJsonObject

`utils/json.ts`에 있는 방어 로직:

```typescript
// step1/src/utils/json.ts:20-35
export const extractJsonObject = (text: string): string => {
  // 1. fenced json 블록 우선 파싱
  const fencedJsonPattern = /```json\s*([\s\S]*?)```/gi;
  let match = fencedJsonPattern.exec(text);
  while (match !== null) {
    const body = match[1].trim();
    if (canParseJsonObject(body)) return body;
    // 중첩된 JSON 시도
    const nested = findFirstJsonObjectSlice(body);
    if (nested) return nested;
    match = fencedJsonPattern.exec(text);
  }

  // 2. bare JSON 시도
  const bare = findFirstJsonObjectSlice(text);
  if (bare) return bare;

  throw new Error("No JSON object found in model output.");
};
```

### 8.3 처리 가능한 입력 유형

| 입력 유형 | 처리 여부 |
|----------|----------|
| `{"key": "value"}` | ✅ |
| ```json\n{"key": "value"}\n``` | ✅ |
| `{"key": "value"}` (텍스트 포함) | ✅ |
| Markdown 없는 bare JSON | ✅ |

---

## 9단계: 학습용 단계 코드 활용 (3분)

### 9.1 study/* 파일들

학습을 위한 4개의 단계별 코드가 있습니다:

```bash
cd step1
pnpm study:1  # DevAgent 단독 이해
pnpm study:2  # Dev/Test 협업 이해
pnpm study:3  # attempt 루프 이해
pnpm study:4  # 전체 통합 이해
```

### 9.2 각 단계의 내용

| 단계 | 파일 | 핵심 내용 |
|------|------|----------|
| 1 | step1-dev-agent.ts | DevAgent만 단독 실행 |
| 2 | step2-dev-test-agent.ts | Dev → Test 순차 실행 |
| 3 | step3-supervisor-loop.ts | attempt 루프 추가 |
| 4 | step4-supervisor-with-services.ts | 파일 적용 + 명령 실행 |

### 🎯 직접 해보세요 #5

```bash
cd step1
pnpm study:1
```

를 실행하고 어떤 출력이 나오는지 확인해 보세요.

---

## 10단계: 자주 나는 오류 해결 (5분)

### 10.1 오류 목록 및 해결법

#### 오류 1: `OPENAI_API_KEY is required`

**원인:** .env 파일에 API 키가 없음

**해결:**
```bash
cd step1
# .env 파일 편집
echo 'OPENAI_API_KEY=your-key-here' >> .env
pnpm dev
```

#### 오류 2: `EADDRINUSE: 0.0.0.0:3000`

**원인:** 포트가 이미 사용 중

**해결:**
```bash
# 포트 사용 중인 프로세스 찾기
lsof -i :3000
# 프로세스 종료
kill -9 <PID>
# 또는 포트 변경
echo 'PORT=3002' >> .env
```

#### 오류 3: `LLM Ping Error "Not Found"`

**원인:** LLM wrapper 경로 불일치

**확인:**
```bash
curl -s http://localhost:3001/api/tools/overview | jq .openaiBaseUrl
# wrapper의 실제 경로와 일치하는지 확인
```

#### 오류 4: 세션이 `running`에서 멈춤

**원인:**
- LLM 응답 지연
- testCommand가 종료되지 않음 (watch 모드 등)

**해결:**
- testCommand는 반드시 종료형 명령 사용: `pnpm test`, `pnpm build`
- LLM 타임아웃 설정 확인

### 🎯 직접 해보세요 #6

의도적으로 오류를 만들어 보고 해결해 보세요:

1. .env의 API 키를 지우고 서버 실행 → 오류 확인
2. 포트를 변경해서 다시 실행 → 성공 확인

---

## 11단계: 확장 포인트 탐색 (3분)

### 11.1 현재 구조에서 가능한 확장

| 확장 포인트 | 현재 | 변경 가능성 |
|-----------|------|------------|
| **상태 영속화** | In-memory | DB로 교체 |
| **타임아웃** | 무제한 | Supervisor에 취소 토큰 추가 |
| **파일 변경 방식** | Full file | Diff patch로 변경 |
| **테스트 분석** | 일반 요약 | 카테고리화 (컴파일/테스트/런타임) |
| **파일 자동 추천** | 수동 입력 | 저장소 검색 기반 |

### 11.2 확장 예시: 타임아웃 추가

```typescript
// Supervisor에 타임아웃 추가 예시
async startWithTimeout(input: SessionInput, timeoutMs: number): Promise<string> {
  const session = this.store.create(input);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), timeoutMs)
  );

  await Promise.race([this.run(session.id), timeoutPromise]);
  return session.id;
}
```

---

## 최종 체크리스트

튜토리얼을 완료했다면 다음을 확인하세요:

- [ ] `pnpm dev`로 서버 정상 실행
- [ ] `curl /api/health` → `{"ok":true}`
- [ ] `curl /api/tools/llm/ping` → 성공 응답
- [ ] 웹 UI에서 세션 1회 실행
- [ ] Events Log에서 `dev` → `test` 순서 확인
- [ ] study:1 ~ study:4 차이점 이해

---

## 다음 단계

이 튜토리얼을 완료했다면:

1. **코드 읽기**: `src/` 폴더의 모든 파일을 읽어보세요
2. **수정해보기**: DevAgent의 프롬프트를 바꿔보세요
3. **실험하기**: 다른 task로 세션을 실행해 보세요
4. **오류 처리**: 실패한 세션의 원인을 분석해 보세요

---

## 부록: API 레퍼런스

### 전체 API 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스 체크 |
| GET | `/api/tools/overview` | 설정 정보 |
| POST | `/api/tools/llm/ping` | LLM 연결 테스트 |
| POST | `/api/tools/command` | 명령 실행 (제한적) |
| POST | `/api/sessions` | 세션 시작 |
| GET | `/api/sessions` | 세션 목록 |
| GET | `/api/sessions/:id` | 세션 상태 + 이벤트 |
| GET | `/api/sessions/:id/events` | SSE 실시간 스트림 |

---

## FAQ

**Q: 왜 두 개의 에이전트를separately 실행하나요?**
A: 개발(코드 변경)과 테스트(결과 분석)의 관심사를 분리하여 각 에이전트가 하나의 역할에 집중하도록 합니다.

**Q: maxAttempts는 어떻게 설정해야 하나요?**
A: 일반적으로 2~4를 사용합니다. 너무 크면 실행 시간이 길어지고, 너무 작으면 실패할 가능성이 높습니다.

**Q: 파일 경로는 어떻게 지정해야 하나요?**
A: 상대경로로 지정하고, 쉼표로 구분합니다. 예: `src/utils/json.ts,tests/json.test.ts`

---

이 튜토리얼이 도움이 되셨나요? 추가 질문이 있으면 언제든지 질문해 주세요!
