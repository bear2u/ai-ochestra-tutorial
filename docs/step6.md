# Step6 상세 개발 정리

## 목표

Step5의 `implementation -> validation -> review` 루프를 유지하면서, Supervisor 보조 판단(advisory)과 PR 패키지 산출(packaging)을 추가한다.

## 핵심 변경

1. 입력 확장
- `topic`, `task(legacy)`, `autonomous` 지원
- 정규화: `effectiveTopic = topic || task`
- 기본값: `autonomous = true`

2. Supervisor advisory(보조)
- 루프 시작 시 advisor 호출(autonomous=true)
- `feedbackPatch`를 implementation feedback에 병합
- advisor 실패는 `advisor_error` 이벤트만 기록하고 메인 루프는 계속 진행
- phase 전이는 기존 규칙(review/validation 결과)에만 의존

3. Packaging 실구현
- review 승인 후 `PackagerAgent` 실행
- `PrPackageArtifact` 생성 및 저장
- `.orchestra/sessions/<sessionId>/pr-package.json` 파일 출력
- packaging 실패 시 `phase_failed(packaging)` + session failed

4. API 확장
- `GET /api/sessions/:id/artifacts`
- `GET /api/sessions/:id/pr-package`

5. CLI/UI 확장
- CLI: `--topic`, `--autonomous`, `--task` legacy 호환
- UI: Topic/Autonomous 입력, advisor/packager role 필터, PR Package Summary 패널

6. 구현 단계 명령 액션
- `DevOutput.commands[]`를 통해 implementation 단계에서 명령 실행 가능
- 안전 정책: 단순 `pnpm`/`npm` 명령만 허용, 쉘 연산자 차단
- 실패 시 `phase_failed(implementation)`로 세션 실패 처리

## 신규 타입/아티팩트

1. `SupervisorAdvice`
- `iteration`, `focusSummary`, `feedbackPatch[]`, `riskNotes[]`, `recommendedAction`, `confidence`

2. `PrPackageArtifact`
- `id`, `sessionId`, `phase`, `iteration`, `topic`, `title`, `body`, `changedFiles[]`
- `testSummary`, `reviewSummary`, `riskNotes[]`, `advisorNotes[]`, `outputPath`, `createdAt`

## 이벤트

1. advisor
- `advisor_started`
- `advisor_suggested`
- `advisor_applied`
- `advisor_skipped`
- `advisor_error`

2. packaging
- `pr_package_created`
- `pr_package_written`

3. implementation command action
- `implementation_commands_requested`
- `implementation_command_started`
- `implementation_command_completed`
- `implementation_command_failed`
- `implementation_command_blocked`
- `implementation_commands_completed`

## 테스트 포인트

1. advisor ON/OFF에 따른 이벤트/피드백 경로 검증
2. review 승인 후 packaging artifact + JSON 파일 생성
3. packaging 실패 시 phase/session 실패 처리
4. `task`, `maxAttempts` legacy 입력 호환
