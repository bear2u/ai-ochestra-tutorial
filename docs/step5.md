# Step5 상세 개발 정리

## 목표

Step4의 구현/검증 루프를 확장해 `review` 단계를 실구현하고, 리뷰 차단 이슈가 있으면 자동 재작업 루프를 수행한다.

## 핵심 변경

1. `ReviewerAgent` 추가
- 산출물: `ReviewArtifact`
- 필드: `blockingIssues`, `nonBlockingIssues`, `score`, `fixPlan`

2. Supervisor 루프 확장
- 기존: `implementation -> validation`
- Step5: `implementation -> validation -> review`
- `blockingIssues.length > 0`이면 implementation으로 회귀

3. 예산 제어 추가
- `maxIterations` (기본 6)
- `maxMinutes` (기본 45)
- 소진 시 `failed_budget_exhausted` 종료

4. 하위호환
- 기존 `maxAttempts` 유지
- 내부적으로 `maxIterations`로 매핑

5. LLM 모델 사전 검증
- `step5` 시작 시 `OPENAI_MODEL`을 먼저 검증
- 가능하면 provider 모델 목록에서 확인
- 모델 목록 API 미지원 시 최소 요청으로 모델 코드 프로브
- 미지원 모델이면 세션 시작 전에 명확한 에러 반환

## 이벤트

신규 이벤트:
- `review_blocking_detected`
- `review_approved`
- `budget_exhausted`

기존 이벤트와 함께 `phase_started/completed/failed`, `artifact_created`, `session_finished` 흐름 유지.

## UI 변경

1. Session Runner
- `Max iterations`, `Max minutes` 입력 추가

2. Event Filter
- `reviewer` role 추가

3. Summary 패널
- `Review Summary`
- `Budget Status`

4. Step5 프리셋
- review 승인 성공
- review blocking 후 회복
- iteration 예산 소진
- minute 예산 소진
- validation 실패 후 회복
- legacy maxAttempts 호환

## 테스트 포인트

1. review 승인 성공 경로
2. review blocking 회귀 경로
3. `failed_budget_exhausted(iterations)`
4. `failed_budget_exhausted(minutes)`
5. 기존 Step4 validation 분류 회귀
