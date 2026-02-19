# Agent Orchestration Lab (Step6)

`step6`는 `step5`의 review loop를 유지하면서 `Supervisor LLM advisory(보조)`와 `PR package 산출(packaging)`을 추가한 단계입니다.

## Step6 변경점 요약

- `SessionInput`이 `topic`, `task(legacy)`, `autonomous`를 지원합니다.
  - 내부 정규화: `topic || task`
  - `autonomous` 기본값: `true`
- `advisor` 역할이 implementation 루프 직전에 보조 피드백을 제안합니다.
  - 이벤트: `advisor_started`, `advisor_suggested`, `advisor_applied`, `advisor_skipped`, `advisor_error`
  - advisory는 참고용이며 phase 전이 규칙을 바꾸지 않습니다.
- `packager` 역할이 review 승인 후 `PrPackageArtifact`를 생성합니다.
- implementation 단계에서 `DevAgent`가 제안한 `commands[]`를 안전 정책으로 실행할 수 있습니다.
  - 허용: 단순 `pnpm`/`npm` 명령
  - 차단: 쉘 연산자(`;`, `&&`, `|`, `` ` ``, `$`, redirection)
  - 실행 이벤트: `implementation_command_started/completed/failed/blocked`
- PR package JSON 파일을 저장합니다.
  - 경로: `.orchestra/sessions/<sessionId>/pr-package.json`
- 신규 API:
  - `GET /api/sessions/:id/artifacts`
  - `GET /api/sessions/:id/pr-package`
- CLI 확장:
  - `--topic`, `--autonomous`
  - `--task`는 legacy 호환으로 유지

## 입력 계약

`POST /api/sessions`:

- `topic` 또는 `task` 중 최소 1개 필수
- `filePaths` 필수
- `testCommand` 또는 `validationCommands` 중 최소 1개 필수
- `autonomous` 선택 (기본 `true`)
- `maxIterations`, `maxMinutes`, `maxAttempts(legacy)` 지원

## 실행

```bash
cd step6
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

## CLI 예시

기본(topic + autonomous):

```bash
pnpm cli -- --topic "step6 advisory + packaging" --files "src/a.ts,src/b.ts" --test "pnpm test" --autonomous true --max-iterations 6 --max-minutes 45
```

legacy(task + maxAttempts):

```bash
pnpm cli -- --task "legacy input compatibility" --files "src/a.ts" --test "pnpm test" --max-attempts 3
```
