# Agent Orchestration Lab (Step5)

`step5`는 `step4` 대비 `review` 단계를 실제 에이전트 실행으로 확장하고, 리뷰 결과에 따라 자율 재작업 루프를 수행합니다.

## Step5 변경점 요약

- `ReviewerAgent`가 `ReviewArtifact`를 생성합니다.
- 루프가 `implementation -> validation`에서 `implementation -> validation -> review`로 확장됩니다.
- review에서 `blockingIssues`가 있으면 implementation으로 자동 회귀합니다.
- 서버/CLI 시작 시 `OPENAI_MODEL` 사전 검증을 수행합니다.
  - 가능하면 provider의 모델 목록에서 확인합니다.
  - 모델 목록 API가 없으면 최소 요청으로 모델 코드를 프로브합니다.
  - 미지원 모델이면 실행 전에 명확한 에러를 반환합니다.
- 예산 제어가 추가됩니다.
  - `maxIterations` (기본 6)
  - `maxMinutes` (기본 45)
- 예산 소진 시 세션이 `failed_budget_exhausted`로 안전 종료됩니다.
- 기존 `maxAttempts` 입력은 하위호환으로 유지되며 내부에서 `maxIterations`로 매핑됩니다.

## 입력 호환성

`POST /api/sessions` 입력:

- `task` (required)
- `filePaths` (required)
- `testCommand` (optional)
- `validationCommands` (optional)
- `maxIterations` (optional)
- `maxMinutes` (optional)
- `maxAttempts` (optional, legacy)

제약:

- `testCommand` 또는 `validationCommands` 중 하나는 반드시 필요합니다.

## 실행

```bash
cd step5
pnpm install
cp .env.example .env
pnpm dev
```

브라우저: `http://localhost:${PORT}`

## 테스트

```bash
pnpm test
pnpm build
```

## CLI

기본:

```bash
pnpm cli -- --task "버그 수정" --files "src/a.ts" --test "pnpm test" --max-iterations 6 --max-minutes 45
```

legacy 호환:

```bash
pnpm cli -- --task "버그 수정" --files "src/a.ts" --test "pnpm test" --max-attempts 3
```
