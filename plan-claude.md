# AI 에이전트 오케스트레이션 개발 로드맵 (TDD 기반)

## 개요
- **최종 목표**: `Supervisor`가 `기획 → 설계 → 디자인 → 개발 → 테스트 → 리뷰 → 패키징`을 **완전 자율**로 수행
- **개발 방식**: TDD (Red → Green → Refactor) 사이클 준수
- **단계 원칙**: `stepN` 복사 후 `stepN+1`에서만 변경, 이전 단계는 동결

---

## 단계 운영 원칙

1. **복사 규칙**: `stepN` → `stepN+1` 복사 시 `node_modules`, `dist`, 캐시/로그 제외
2. **동결 원칙**: 이전 단계는 회귀 기준선으로 고정
3. **완료 조건**: `pnpm test` 통과 + 해당 단계 신규 테스트 통과
4. **문서화**: 각 단계 `README.md`에 "이전 단계 대비 변경점" 섹션 유지

---

## Step1 (완료, 베이스라인)

### 상태
- 완료됨, 기능 확장 없음

### 구성
- 2-agent 순차 오케스트레이션 (Dev/Test)
- Supervisor + SSE 이벤트 스트리밍
- 기본 API: `/health`, `/api/sessions`, `/api/sessions/:id/events`

### 회귀 테스트 (유지해야 할 것들)
```
✓ GET /health → 200 OK
✓ POST /api/sessions → sessionId 반환
✓ GET /api/sessions/:id/events → SSE 스트림
✓ Dev 에이전트 실행 후 Test 에이전트 실행
```

---

## Step2: 워크플로우 엔진 뼈대

### 목표
Supervisor를 phase 기반 실행기로 리팩터링

### 새로운 타입 정의
```typescript
// types/phase.ts
type PhaseName = 'planning' | 'architecture' | 'design' | 'implementation' | 'validation' | 'review' | 'packaging';

type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface PhaseConfig {
  name: PhaseName;
  required: boolean;
  timeout?: number;
  retryLimit: number;
}

// types/agent.ts
type AgentRole = 'planner' | 'architect' | 'designer' | 'developer' | 'tester' | 'reviewer' | 'packager';

// types/event.ts
interface SessionEvent {
  id: string;
  sessionId: string;
  type: string;
  phase?: PhaseName;      // NEW
  iteration?: number;     // NEW
  timestamp: Date;
  data?: unknown;
}
```

### 테스트 케이스 (TDD)
```
[Phase Engine]
✓ phase 순서대로 실행됨 (planning → architecture → ... → packaging)
✓ 각 phase 시작/완료 이벤트가 기록됨
✓ phase 실패 시 실패 이벤트 기록 후 다음 phase로 진행 또는 중단
✓ phase 타임아웃 동작

[Phase-Event 연동]
✓ SessionEvent에 phase 필드가 포함됨
✓ SessionEvent에 iteration 필드가 포함됨

[회귀]
✓ Step1 API 동작 유지 (health, sessions, events)
```

### 파일 구조 변경
```
step2/
├── src/
│   ├── types/
│   │   ├── phase.ts          # NEW
│   │   ├── agent.ts          # 확장
│   │   └── event.ts          # 확장
│   ├── engine/
│   │   └── PhaseEngine.ts    # NEW: phase 실행 엔진
│   └── supervisor/
│       └── Supervisor.ts     # 리팩터링: PhaseEngine 사용
└── tests/
    ├── engine/
    │   └── PhaseEngine.test.ts  # NEW
    └── regression/
        └── step1.test.ts        # 회귀 테스트
```

### 구현 순서 (TDD)
1. **Red**: `PhaseEngine` 테스트 작성
2. **Green**: 최소 구현으로 테스트 통과
3. **Refactor**: 코드 정리
4. **Red**: 회귀 테스트 작성
5. **Green**: Step1 API 호환성 확인

---

## Step3: 기획/설계/디자인 에이전트 도입

### 목표
상위 단계 에이전트 추가 및 아티팩트 계약 도입

### 새로운 에이전트
```typescript
// agents/PlannerAgent.ts
interface PlanArtifact {
  id: string;
  sessionId: string;
  phase: 'planning';
  topic: string;
  goals: string[];
  requirements: FunctionalRequirement[];
  constraints: Constraint[];
  assumptions: string[];
  createdAt: Date;
}

// agents/ArchitectAgent.ts
interface ArchitectureArtifact {
  id: string;
  sessionId: string;
  phase: 'architecture';
  techStack: TechStackDecision[];
  structure: FileStructure[];
  patterns: Pattern[];
  dependencies: Dependency[];
  risks: Risk[];
  createdAt: Date;
}

// agents/DesignerAgent.ts
interface DesignArtifact {
  id: string;
  sessionId: string;
  phase: 'design';
  components: ComponentDesign[];
  apis: ApiDesign[];
  dataModels: DataModel[];
  interactions: Interaction[];
  createdAt: Date;
}
```

### 아티팩트 스토어
```typescript
// store/ArtifactStore.ts
interface ArtifactStore {
  save(artifact: Artifact): Promise<void>;
  get(sessionId: string, phase: PhaseName): Promise<Artifact | null>;
  getAll(sessionId: string): Promise<Artifact[]>;
}
```

### 테스트 케이스 (TDD)
```
[PlannerAgent]
✓ topic 입력으로 PlanArtifact 생성
✓ PlanArtifact 스키마 검증
✓ 스키마 불일치 시 에러 이벤트

[ArchitectAgent]
✓ PlanArtifact 입력으로 ArchitectureArtifact 생성
✓ ArchitectureArtifact 스키마 검증

[DesignerAgent]
✓ ArchitectureArtifact 입력으로 DesignArtifact 생성
✓ DesignArtifact 스키마 검증

[ArtifactStore]
✓ 아티팩트 저장 및 조회
✓ 세션별 아티팩트 목록 조회

[통합]
✓ planning → architecture → design 순차 실행
✓ 각 단계 산출물이 다음 단계로 전달됨
```

### 파일 구조 변경
```
step3/
├── src/
│   ├── agents/
│   │   ├── PlannerAgent.ts      # NEW
│   │   ├── ArchitectAgent.ts    # NEW
│   │   ├── DesignerAgent.ts     # NEW
│   │   └── BaseAgent.ts         # 추상화
│   ├── artifacts/
│   │   ├── PlanArtifact.ts      # NEW
│   │   ├── ArchitectureArtifact.ts  # NEW
│   │   └── DesignArtifact.ts    # NEW
│   ├── store/
│   │   └── ArtifactStore.ts     # NEW
│   └── schemas/
│       ├── plan.schema.ts       # Zod 스키마
│       ├── architecture.schema.ts
│       └── design.schema.ts
└── tests/
    ├── agents/
    │   ├── PlannerAgent.test.ts
    │   ├── ArchitectAgent.test.ts
    │   └── DesignerAgent.test.ts
    ├── store/
    │   └── ArtifactStore.test.ts
    └── integration/
        └── planning-to-design.test.ts
```

---

## Step4: 개발/테스트 자동 루프 고도화

### 목표
구현-검증 파이프라인 자동화

### DeveloperAgent 개선
```typescript
interface CodeChange {
  path: string;
  patch?: string;           // 우선 적용
  fallbackContent?: string; // patch 실패 시 전체 교체
}

interface DeveloperInput {
  design: DesignArtifact;
  previousCode?: CodeChange[];
}

interface DeveloperOutput {
  changes: CodeChange[];
  summary: string;
}
```

### ValidationPipeline
```typescript
interface ValidationPipeline {
  commands: ValidationCommand[];
  run(): Promise<ValidationResult>;
}

interface ValidationCommand {
  name: 'lint' | 'typecheck' | 'test';
  command: string;
  timeout: number;
}

interface ValidationResult {
  success: boolean;
  results: CommandResult[];
  classification: 'lint' | 'type' | 'test' | 'runtime' | 'unknown';
  summary: string;
}

interface ValidationArtifact {
  id: string;
  sessionId: string;
  phase: 'validation';
  results: ValidationResult[];
  passed: boolean;
  createdAt: Date;
}
```

### 테스트 케이스 (TDD)
```
[DeveloperAgent]
✓ DesignArtifact 기반 코드 변경 생성
✓ patch 포맷으로 변경 사항 생성
✓ patch 적용 실패 시 fallbackContent 사용

[ValidationPipeline]
✓ lint → typecheck → test 순차 실행
✓ 각 명령 결과 요약
✓ 실패 원인 분류 (lint|type|test|runtime|unknown)
✓ ValidationArtifact 생성

[통합]
✓ implementation → validation 자동 루프
✓ 검증 실패 시 원인 분류 기록
```

### 파일 구조 변경
```
step4/
├── src/
│   ├── agents/
│   │   └── DeveloperAgent.ts    # 개선
│   ├── pipeline/
│   │   └── ValidationPipeline.ts  # NEW
│   ├── artifacts/
│   │   └── ValidationArtifact.ts  # NEW
│   └── utils/
│       └── patch.ts             # NEW: patch 적용 유틸
└── tests/
    ├── pipeline/
    │   └── ValidationPipeline.test.ts
    └── integration/
        └── implementation-validation.test.ts
```

---

## Step5: 리뷰 에이전트 + 자율 재작업 루프

### 목표
코드 리뷰 및 자동 수정 루프 구현

### ReviewerAgent
```typescript
interface ReviewArtifact {
  id: string;
  sessionId: string;
  phase: 'review';
  score: number;              // 0-100
  blockingIssues: Issue[];
  nonBlockingIssues: Issue[];
  fixPlan?: FixPlan;
  approved: boolean;
  createdAt: Date;
}

interface Issue {
  id: string;
  severity: 'blocking' | 'warning' | 'info';
  category: string;
  message: string;
  location?: CodeLocation;
  suggestion?: string;
}

interface FixPlan {
  priorityIssues: string[];
  approach: string;
  estimatedEffort: 'low' | 'medium' | 'high';
}
```

### 예산 관리
```typescript
interface Budget {
  maxIterations: number;      // default: 6
  maxMinutes: number;         // default: 45
  currentIteration: number;
  elapsedMinutes: number;
  isExhausted(): boolean;
}
```

### 테스트 케이스 (TDD)
```
[ReviewerAgent]
✓ 코드 변경에 대한 리뷰 수행
✓ blocking/nonBlocking 이슈 분류
✓ 점수 산정 (0-100)
✓ fixPlan 생성

[자율 루프]
✓ blocking issue 있을 시 implementation으로 회귀
✓ blocking issue 없을 시 packaging으로 진행
✓ maxIterations 초과 시 안전 종료
✓ maxMinutes 초과 시 안전 종료

[예산 관리]
✓ Budget.isExhausted() 동작
✓ 종료 이벤트에 실패 사유 기록
```

### 파일 구조 변경
```
step5/
├── src/
│   ├── agents/
│   │   └── ReviewerAgent.ts     # NEW
│   ├── artifacts/
│   │   └── ReviewArtifact.ts    # NEW
│   ├── control/
│   │   ├── Budget.ts            # NEW
│   │   └── LoopController.ts    # NEW
│   └── supervisor/
│       └── Supervisor.ts        # 루프 로직 추가
└── tests/
    ├── agents/
    │   └── ReviewerAgent.test.ts
    ├── control/
    │   ├── Budget.test.ts
    │   └── LoopController.test.ts
    └── integration/
        └── autonomous-loop.test.ts
```

---

## Step6: PR 후보 패키지 생성

### 목표
최종 산출물 패키지 생성 및 API 확장

### PackagerAgent
```typescript
interface PrPackageArtifact {
  id: string;
  sessionId: string;
  phase: 'packaging';
  title: string;
  body: string;
  changedFiles: string[];
  testSummary: string;
  reviewSummary: string;
  riskNotes: string[];
  recommendations: string[];
  createdAt: Date;
}
```

### API 확장
```
GET  /api/sessions/:id/artifacts         # 전체 아티팩트 목록
GET  /api/sessions/:id/artifacts/:phase  # 특정 phase 아티팩트
GET  /api/sessions/:id/pr-package        # PR 패키지
POST /api/sessions/:id/cancel            # 세션 취소
```

### CLI 확장
```bash
orchestra start --topic "기능 설명"
orchestra start --topic "기능 설명" --files src/foo.ts,src/bar.ts
orchestra start --topic "기능 설명" --autonomous
```

### 테스트 케이스 (TDD)
```
[PackagerAgent]
✓ 모든 아티팩트 취합하여 PrPackageArtifact 생성
✓ title, body 자동 생성
✓ changedFiles 목록 생성
✓ testSummary, reviewSummary 포함
✓ riskNotes 생성

[API]
✓ GET /api/sessions/:id/artifacts → 아티팩트 목록
✓ GET /api/sessions/:id/artifacts/:phase → 특정 아티팩트
✓ GET /api/sessions/:id/pr-package → PR 패키지
✓ POST /api/sessions/:id/cancel → 세션 취소

[E2E]
✓ topic 입력 → pr-package.json 생성
✓ 전체 phase 타임라인 확인
```

### 파일 구조 변경
```
step6/
├── src/
│   ├── agents/
│   │   └── PackagerAgent.ts     # NEW
│   ├── artifacts/
│   │   └── PrPackageArtifact.ts # NEW
│   ├── api/
│   │   └── routes/
│   │       ├── artifacts.ts     # NEW
│   │       └── pr-package.ts    # NEW
│   └── cli/
│       └── commands/
│           └── start.ts         # 확장
└── tests/
    ├── e2e/
    │   └── full-pipeline.test.ts
    └── api/
        └── artifacts.test.ts
```

---

## Step7: 안정성/관측성 강화

### 목표
영속화, 복구, 메트릭, 제어 기능 추가

### 영속화
```typescript
interface SessionPersistence {
  save(session: SessionState): Promise<void>;
  load(sessionId: string): Promise<SessionState | null>;
  listRunning(): Promise<SessionState[]>;
}
```

### 메트릭
```typescript
interface SessionMetrics {
  phaseLatencies: Map<PhaseName, number>;
  failureClassifications: Map<string, number>;
  successRate: number;
  totalSessions: number;
  averageDuration: number;
}
```

### 테스트 케이스 (TDD)
```
[영속화]
✓ 세션 상태 저장
✓ 세션 상태 로드
✓ 서버 재시작 후 running 세션 복구

[메트릭]
✓ phase latency 기록
✓ 실패 분류 통계
✓ 성공률 계산

[제어]
✓ timeout 동작
✓ cancel 동작
✓ 장시간 세션에서 timeout/cancel 검증
```

### 파일 구조 변경
```
step7/
├── src/
│   ├── persistence/
│   │   ├── SessionPersistence.ts  # NEW
│   │   └── FilePersistence.ts    # NEW
│   ├── metrics/
│   │   └── SessionMetrics.ts     # NEW
│   └── api/
│       └── routes/
│           └── metrics.ts        # NEW
└── tests/
    ├── persistence/
    │   └── SessionPersistence.test.ts
    └── metrics/
        └── SessionMetrics.test.ts
```

---

## Step8: 운영 하드닝

### 목표
보안, 안전 가드, dry-run 모드 추가

### 안전 정책
```typescript
interface SafetyPolicy {
  allowedCommands: string[];
  maxCommandRuntime: number;      // ms
  maxOutputSize: number;          // bytes
  maxChangedFiles: number;
  maxPatchBytes: number;
  sensitivePatterns: RegExp[];
}

interface DryRunResult {
  wouldChange: CodeChange[];
  validations: ValidationResult[];
  estimatedDuration: number;
}
```

### 테스트 케이스 (TDD)
```
[안전 정책]
✓ allowlist 외 명령 차단
✓ maxCommandRuntime 초과 시 종료
✓ maxOutputSize 초과 시 잘라내기
✓ maxChangedFiles 초과 시 거부
✓ maxPatchBytes 초과 시 거부
✓ 민감 패턴 감지

[dry-run]
✓ 파일 미반영 시뮬레이션
✓ dry-run과 실제 실행 결과 비교

[E2E]
✓ 안전 가드 우회 없이 자동 세션 완주
✓ 운영 체크리스트 검증
```

### 파일 구조 변경
```
step8/
├── src/
│   ├── safety/
│   │   ├── SafetyPolicy.ts       # NEW
│   │   ├── CommandFilter.ts      # NEW
│   │   └── SensitivePatternDetector.ts  # NEW
│   ├── dryrun/
│   │   └── DryRunner.ts          # NEW
│   └── docs/
│       ├── checklist.md          # NEW
│       └── runbook.md            # NEW
└── tests/
    ├── safety/
    │   └── SafetyPolicy.test.ts
    └── e2e/
        └── hardening.test.ts
```

---

## 타입 요약

### 공개 API 타입
```typescript
// 입력
interface SessionInput {
  topic: string;
  filePaths?: string[];
  validationCommands?: ValidationCommand[];
  maxIterations?: number;     // default: 6
  maxMinutes?: number;        // default: 45
  autonomous?: boolean;
  dryRun?: boolean;
}

// 상태
interface SessionState {
  id: string;
  input: SessionInput;
  status: SessionStatus;
  currentPhase: PhaseName;
  phaseStatuses: Map<PhaseName, PhaseStatus>;
  iteration: number;
  artifactRefs: Map<PhaseName, string>;
  budget: Budget;
  createdAt: Date;
  updatedAt: Date;
}

// 이벤트
interface SessionEvent {
  id: string;
  sessionId: string;
  type: EventType;
  phase?: PhaseName;
  iteration?: number;
  artifactId?: string;
  classification?: string;
  timestamp: Date;
  data?: unknown;
}
```

---

## 테스트 전략

### 1. 단위 테스트
- 각 에이전트별 독립 동작
- 스키마 검증
- 실패 분류기
- 예산 종료 조건

### 2. 통합 테스트
- Phase 간 전이
- 아티팩트 전달
- 자율 루프

### 3. E2E 테스트
- topic → pr-package.json 전체 경로
- 회귀: Step1 API 호환성

### 4. 장애 테스트
- LLM 오류 복구
- 명령 timeout 복구
- JSON 파싱 오류 복구

---

## 가정 및 기본값

| 항목 | 값 |
|------|-----|
| 실행 범위 | 단일 로컬 리포지토리 |
| 승인 정책 | 완전 자율 (사람 승인 없음) |
| 검증 명령 | `pnpm lint`, `pnpm typecheck`, `pnpm test` |
| maxIterations | 6 |
| maxMinutes | 45 |
| 저장소 | 인메모리 + 파일 (Step7에서 SQLite로 확장) |

---

## 시작하기

Step2부터 TDD로 진행합니다:

```bash
# Step2 시작
cp -r step1 step2
cd step2
pnpm install

# 첫 번째 테스트 작성 (Red)
# 테스트 실행 후 실패 확인
pnpm test

# 최소 구현 (Green)
# 테스트 통과 확인
pnpm test

# 리팩터링 (Refactor)
# 테스트 여전히 통과 확인
pnpm test
```

"go"라고 말하면 plan.md에서 정의된 테스트를 하나씩 구현하겠습니다.
