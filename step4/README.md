# Agent Orchestration Lab (Step4)

`step4`는 `step3` 대비 구현/검증 루프를 고도화한 버전입니다.

## Step4 변경점 요약

- Dev 변경 포맷이 patch 우선으로 확장되었습니다.
  - `changes[{ path, patch, fallbackContent }]`
  - patch 적용 실패 시 fallbackContent로 안전하게 반영합니다.
- Validation이 단일 test 명령에서 파이프라인으로 확장되었습니다.
  - 기본: `pnpm lint -> pnpm typecheck -> testCommand`
  - 또는 `validationCommands[]` 직접 지정
- 실패 분류가 추가되었습니다.
  - `lint | type | test | runtime | unknown`
- `ValidationArtifact`를 iteration마다 생성/저장합니다.
- UI에 `Validation commands` 입력과 `Validation Summary` 섹션이 추가되었습니다.

## 입력 호환성

`POST /api/sessions` 입력 규칙:

- `task` (required)
- `filePaths` (required)
- `maxAttempts` (required)
- `testCommand` (optional)
- `validationCommands` (optional)

제약:

- `testCommand` 또는 `validationCommands` 중 하나는 반드시 필요합니다.

## 실행

```bash
cd step4
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

기존 방식:

```bash
pnpm cli -- --task "버그 수정" --files "src/a.ts" --test "pnpm test" --max-attempts 3
```

파이프라인 명령 직접 지정:

```bash
pnpm cli -- --task "버그 수정" --files "src/a.ts" --validation-commands "pnpm lint,pnpm typecheck,pnpm test" --max-attempts 3
```
