const form = document.getElementById("session-form");
const quickTopicForm = document.getElementById("quick-topic-form");
const statusEl = document.getElementById("status");
const phaseTrackerEl = document.getElementById("phase-tracker");
const phaseMetaEl = document.getElementById("phase-meta");
const validationSummaryEl = document.getElementById("validation-summary");
const reviewSummaryEl = document.getElementById("review-summary");
const prPackageSummaryEl = document.getElementById("pr-package-summary");
const budgetStatusEl = document.getElementById("budget-status");
const promptLogsEl = document.getElementById("prompt-logs");
const supervisorLogEl = document.getElementById("supervisor-log");
const supervisorMetaEl = document.getElementById("supervisor-meta");
const eventsEl = document.getElementById("events");
const sessionsListEl = document.getElementById("sessions-list");
const diagnosticsEl = document.getElementById("diagnostics-output");

const refreshOverviewBtn = document.getElementById("refresh-overview");
const pingHealthBtn = document.getElementById("ping-health");
const pingLlmBtn = document.getElementById("ping-llm");
const runCommandBtn = document.getElementById("run-command");
const refreshSessionsBtn = document.getElementById("refresh-sessions");
const refreshPrPackageBtn = document.getElementById("refresh-pr-package");
const supervisorIncludeAdvisorInput = document.getElementById("supervisor-include-advisor");

const pingPromptInput = document.getElementById("ping-prompt");
const commandInput = document.getElementById("tool-command");
const presetSelect = document.getElementById("session-preset");
const presetHelp = document.getElementById("session-preset-help");
const presetPreviewEl = document.getElementById("session-preset-preview");
const topicInput = document.getElementById("topic");
const workspaceRootInput = document.getElementById("workspaceRoot");
const quickTopicInput = document.getElementById("quick-topic");
const quickWorkspaceRootInput = document.getElementById("quick-workspace-root");
const quickTopicAutonomousInput = document.getElementById("quick-topic-autonomous");
const quickTopicRunBtn = document.getElementById("quick-topic-run");
const taskInput = document.getElementById("task");
const filesInput = document.getElementById("files");
const testInput = document.getElementById("test");
const validationCommandsInput = document.getElementById("validationCommands");
const autonomousInput = document.getElementById("autonomous");
const maxIterationsInput = document.getElementById("maxIterations");
const maxMinutesInput = document.getElementById("maxMinutes");
const roleFilterInputs = [...document.querySelectorAll("input[data-role-filter]")];

let stream;
let activeSessionId = "";
let activeSessionState = null;
let activePrPackage = null;
let activePresetConfig = null;
let defaultWorkspaceRoot = ".";
const allEvents = [];
const seenEventKeys = new Set();
const activeRoleFilters = new Set(roleFilterInputs.filter((input) => input.checked).map((input) => input.value));

const now = () => new Date().toISOString();
const isTerminalSessionStatus = (status) => status === "success" || status === "failed";

const closeEventStream = () => {
  if (!stream) return;
  stream.close();
  stream = undefined;
};

const toPrettyJson = (value) => JSON.stringify(value, null, 2);
const phaseOrder = ["planning", "architecture", "design", "implementation", "validation", "review", "packaging"];
const loopPhases = new Set(["implementation", "validation", "review"]);

const sessionPresets = [
  {
    id: "step6-supervisor-llm-advisory-only",
    label: "1) Supervisor LLM Advisory 전용 체크",
    stage: "step6-supervisor-llm-advisory-only",
    description: "감독관(advisor) LLM 호출/적용 이벤트만 빠르게 확인하는 최소 시나리오입니다.",
    topic: "[force_review_approve] step6 supervisor llm advisory only",
    task: "",
    autonomous: true,
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 2,
    maxMinutes: 20,
    expected: "advisor_started -> advisor_suggested -> advisor_applied -> review_approved -> pr_package_written",
    checkpoints: ["advisor_started", "advisor_suggested", "advisor_applied", "review_approved", "pr_package_written"]
  },
  {
    id: "step6-advisory-on-success",
    label: "2) Advisory ON 성공",
    stage: "step6-advisory-on",
    description: "advisor 제안을 반영하면서 review 승인 후 PR package를 생성합니다.",
    topic: "[force_review_approve] step6 advisory on success",
    task: "",
    autonomous: true,
    filePaths: ["playground/planning-smoke.md", "playground/architecture-smoke.md", "playground/design-smoke.md"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 4,
    maxMinutes: 45,
    expected: "advisor_applied -> review_approved -> pr_package_written -> success",
    checkpoints: ["advisor_applied", "review_approved", "pr_package_written", "session_finished(success)"]
  },
  {
    id: "step6-advisory-off-success",
    label: "3) Advisory OFF 성공",
    stage: "step6-advisory-off",
    description: "autonomous=false에서 advisor를 건너뛰고 review 승인 후 packaging 완료를 확인합니다.",
    topic: "[force_review_approve] step6 advisory off success",
    task: "",
    autonomous: false,
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 4,
    maxMinutes: 45,
    expected: "advisor_skipped -> review_approved -> pr_package_written -> success",
    checkpoints: ["advisor_skipped", "review_approved", "pr_package_written", "session_finished(success)"]
  },
  {
    id: "step6-packaging-failure",
    label: "4) Packaging 강제 실패",
    stage: "step6-packaging-failure",
    description: "packaging 단계에서 강제 실패를 발생시켜 phase_failed(packaging)와 세션 실패를 확인합니다.",
    topic: "[force_review_approve][force_packaging_fail] step6 forced packaging failure",
    task: "",
    autonomous: true,
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "review 승인 후 packaging phase_failed 및 session failed",
    checkpoints: ["review_approved", "phase_failed(packaging)", "session_finished(failed)"]
  },
  {
    id: "step6-topic-only-input",
    label: "5) Topic-only 입력",
    stage: "step6-topic-only",
    description: "topic만 전달해도 내부적으로 task/topic이 정규화되고 세션이 정상 동작하는지 확인합니다.",
    topic: "[force_review_approve] step6 topic only request",
    task: "",
    autonomous: true,
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('topic only ok'); process.exit(0)\"",
    validationCommands: [],
    maxIterations: 3,
    maxMinutes: 30,
    expected: "topic-only 입력으로 review 승인 후 packaging 성공",
    checkpoints: ["session_started(topic)", "review_approved", "pr_package_written"]
  },
  {
    id: "step6-validation-fail-twice-then-pass",
    label: "6) Validation 2회 실패 후 성공",
    stage: "step6-validation-retry",
    description: "validation을 2회 실패 후 3회차에 성공시키며 advisor+review loop를 관찰합니다.",
    topic: "[force_review_approve] step6 validation fails twice then succeeds",
    task: "",
    autonomous: true,
    filePaths: ["playground/validation-fail.txt", "playground/validation-pass.txt"],
    testCommand: "",
    validationCommands: [
      "node -e \"const fs=require('fs');const p='.step6_retry_twice';const n=fs.existsSync(p)?(parseInt(fs.readFileSync(p,'utf8'),10)||0):0;if(n>=2){fs.unlinkSync(p);console.log('pass on third iteration');process.exit(0)}fs.writeFileSync(p,String(n+1));console.error('forced fail iteration '+(n+1));process.exit(1)\""
    ],
    maxIterations: 6,
    maxMinutes: 45,
    expected: "tests_failed x2 후 tests_passed + review_approved + packaging 성공",
    checkpoints: ["tests_failed", "tests_passed", "review_approved", "pr_package_written"]
  },
  {
    id: "step6-legacy-max-attempts-compat",
    label: "7) Legacy task/maxAttempts 호환",
    stage: "step6-legacy-compat",
    description: "legacy task와 maxAttempts 입력 기반에서도 Step6 동작이 유지되는지 검증합니다.",
    topic: "",
    task: "[force_review_approve] step6 legacy task maxAttempts compatibility",
    autonomous: true,
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    validationCommands: [],
    maxIterations: 3,
    maxMinutes: 45,
    useLegacyMaxAttempts: true,
    expected: "legacy 입력(task/maxAttempts)으로 review 승인 및 packaging 완료",
    checkpoints: ["maxAttempts 매핑", "review_approved", "pr_package_written", "session_finished(success)"]
  },
  {
    id: "step6-review-blocking-budget-exhausted",
    label: "8) Review blocking + 예산 소진",
    stage: "step6-review-blocking-budget",
    description: "review를 강제로 blocking 처리하여 재작업 루프 후 iteration 예산 소진을 검증합니다.",
    topic: "[force_review_block] step6 review blocking until budget exhausted",
    task: "",
    autonomous: true,
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "review_blocking_detected 반복 후 budget_exhausted + failed_budget_exhausted",
    checkpoints: ["review_blocking_detected", "budget_exhausted", "session_finished(failed_budget_exhausted)"]
  },
  {
    id: "step6-validation-runtime-failure",
    label: "9) Validation runtime 실패 분류",
    stage: "step6-validation-runtime-failure",
    description: "validation command 런타임 오류를 강제해 classification=runtime 경로를 확인합니다.",
    topic: "[force_review_approve] step6 validation runtime failure classification",
    task: "",
    autonomous: true,
    filePaths: ["playground/fail-fast.txt"],
    testCommand: "",
    validationCommands: ["node -e \"throw new Error('forced runtime failure in validation')\""],
    maxIterations: 2,
    maxMinutes: 20,
    expected: "tests_failed(classification=runtime) 누적 후 failed_budget_exhausted",
    checkpoints: ["tests_failed", "validation_command_failed", "budget_exhausted", "session_finished(failed_budget_exhausted)"]
  },
  {
    id: "step6-default-validation-pipeline",
    label: "10) 기본 Validation 파이프라인",
    stage: "step6-default-validation-pipeline",
    description: "validationCommands를 비우고 testCommand만 전달해 기본 lint/type/test 파이프라인을 검증합니다.",
    topic: "[force_review_approve] step6 default validation pipeline",
    task: "",
    autonomous: true,
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('pipeline test command ok'); process.exit(0)\"",
    validationCommands: [],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "validation_command_started(lint/type/test) 후 review_approved + packaging 성공",
    checkpoints: ["validation_command_started", "tests_passed", "review_approved", "pr_package_written"]
  },
  {
    id: "step6-topic-task-both-topic-priority",
    label: "11) Topic 우선순위 검증",
    stage: "step6-topic-priority",
    description: "topic과 task를 동시에 전달할 때 topic 기준으로 내부 정규화되는지 확인합니다.",
    topic: "[force_review_approve] step6 topic should win over task",
    task: "[force_review_block] conflicting legacy task",
    autonomous: true,
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "task 충돌값 무시(topic 우선)로 review_approved 및 packaging 성공",
    checkpoints: ["session_started", "review_approved", "pr_package_written", "session_finished(success)"]
  },
  {
    id: "step6-legacy-task-autonomous-off",
    label: "12) Legacy task + Autonomous OFF",
    stage: "step6-legacy-task-autonomous-off",
    description: "topic 없이 legacy task만 사용하면서 autonomous=false일 때 advisor_skipped 경로를 검증합니다.",
    topic: "",
    task: "[force_review_approve] step6 legacy task only autonomous off",
    autonomous: false,
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('legacy autonomous off ok'); process.exit(0)\"",
    validationCommands: [],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "legacy task 입력 + advisor_skipped + review_approved + packaging 성공",
    checkpoints: ["advisor_skipped", "review_approved", "pr_package_written", "session_finished(success)"]
  }
];

const writeDiagnostics = (title, payload) => {
  const header = `[${now()}] ${title}`;
  const body = typeof payload === "string" ? payload : toPrettyJson(payload);
  diagnosticsEl.textContent = `${header}\n${body}`;
};

const defaultPresetHelp = "선택 시 Topic/Task, File paths, Validation/Test command, Autonomous, 예산이 자동 입력됩니다.";
const defaultPresetPreview = "시나리오를 선택하면 Step6 체크포인트를 미리 보여줍니다.";

const parseValidationCommands = (value) =>
  value
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

const isWorkspaceDefaultPlaceholder = (value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length === 0 || normalized === ".";
};

const applyWorkspaceRootDefault = (workspaceRoot) => {
  const normalized = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
  if (!normalized) {
    return;
  }

  defaultWorkspaceRoot = normalized;
  if (workspaceRootInput && isWorkspaceDefaultPlaceholder(workspaceRootInput.value)) {
    workspaceRootInput.value = normalized;
  }
  if (quickWorkspaceRootInput && isWorkspaceDefaultPlaceholder(quickWorkspaceRootInput.value)) {
    quickWorkspaceRootInput.value = normalized;
  }
};

const quickRunDefaults = {
  filePaths: ["playground/implementation-smoke.txt"],
  validationCommands: ["node -e \"console.log('quick validation ok'); process.exit(0)\""],
  maxIterations: 3,
  maxMinutes: 30
};

const quickNextDefaults = {
  filePaths: ["src/app/page.tsx", "src/app/globals.css", "package.json"],
  validationCommands: ["pnpm lint"]
};

const shouldUseNextQuickDefaults = (topic) => /(next|shadcn|todo|kanban|칸반)/i.test(topic);

const applySessionPreset = (presetId) => {
  const preset = sessionPresets.find((item) => item.id === presetId);
  if (!preset) {
    activePresetConfig = null;
    if (presetHelp) presetHelp.textContent = defaultPresetHelp;
    if (presetPreviewEl) presetPreviewEl.textContent = defaultPresetPreview;
    return;
  }
  activePresetConfig = preset;

  topicInput.value = preset.topic ?? "";
  taskInput.value = preset.task ?? "";
  filesInput.value = preset.filePaths.join(",");
  testInput.value = preset.testCommand;
  validationCommandsInput.value = (preset.validationCommands ?? []).join("\n");
  autonomousInput.checked = preset.autonomous ?? true;
  maxIterationsInput.value = String(preset.maxIterations ?? 6);
  maxMinutesInput.value = String(preset.maxMinutes ?? 45);

  if (presetHelp) {
    presetHelp.textContent = `${preset.stage} · ${preset.description}`;
  }
  if (presetPreviewEl) {
    const checkpoints = Array.isArray(preset.checkpoints) ? preset.checkpoints.join(" | ") : "-";
    presetPreviewEl.textContent = `Expected: ${preset.expected ?? "-"}\nCheckpoints: ${checkpoints}`;
  }

  writeDiagnostics("Preset Applied", {
    preset: preset.label,
    stage: preset.stage,
    topic: preset.topic ?? "",
    task: preset.task,
    autonomous: preset.autonomous ?? true,
    filePaths: preset.filePaths,
    testCommand: preset.testCommand,
    validationCommands: preset.validationCommands ?? [],
    maxIterations: preset.maxIterations,
    maxMinutes: preset.maxMinutes,
    expected: preset.expected ?? "",
    checkpoints: preset.checkpoints ?? []
  });
};

const initSessionPresets = () => {
  if (!presetSelect) return;

  for (const preset of sessionPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  }

  presetSelect.addEventListener("change", () => {
    applySessionPreset(presetSelect.value);
  });
};

const formatPhaseLabel = (phase) => phase.charAt(0).toUpperCase() + phase.slice(1);

const renderPhaseTracker = (session) => {
  if (!phaseTrackerEl) return;

  phaseTrackerEl.replaceChildren();
  if (!session) {
    if (phaseMetaEl) phaseMetaEl.textContent = "No session selected.";
    const empty = document.createElement("div");
    empty.className = "phase-note";
    empty.textContent = "세션을 선택하거나 시작하면 단계 상태가 여기에 표시됩니다.";
    phaseTrackerEl.appendChild(empty);
    return;
  }

  if (phaseMetaEl) {
    const iteration = Number.isFinite(session.iteration) ? session.iteration : 0;
    const currentPhase = session.currentPhase ?? "-";
    phaseMetaEl.textContent = `status ${session.status} | iteration ${iteration} | current ${currentPhase}`;
  }

  for (const phase of phaseOrder) {
    const status = session.phaseStatuses?.[phase] ?? "pending";
    const isCurrent = session.currentPhase === phase;

    const item = document.createElement("article");
    item.className = `phase-item status-${status}${isCurrent ? " is-current" : ""}`;
    item.setAttribute("role", "listitem");

    const head = document.createElement("div");
    head.className = "phase-item-head";

    const name = document.createElement("span");
    name.className = "phase-name";
    name.textContent = formatPhaseLabel(phase);

    const state = document.createElement("span");
    state.className = "phase-state";
    state.textContent = status;

    head.append(name, state);

    const note = document.createElement("div");
    note.className = "phase-note";
    if (isCurrent && session.status === "running") {
      note.textContent = "현재 실행 중";
    } else if (loopPhases.has(phase) && Number.isFinite(session.iteration) && session.iteration > 0) {
      note.textContent = `iteration ${session.iteration}`;
    } else if (phase === "planning" || phase === "architecture" || phase === "design") {
      note.textContent = "pre-loop";
    } else {
      note.textContent = "post-loop";
    }

    item.append(head, note);
    phaseTrackerEl.appendChild(item);
  }
};

const eventKey = (event) =>
  event?.id ? String(event.id) : `${event?.timestamp ?? ""}|${event?.role ?? ""}|${event?.type ?? ""}|${event?.message ?? ""}`;

const createEventRow = (event) => {
  const row = document.createElement("article");
  const roleClass = `role-${event.role ?? "unknown"}`;
  const budgetEvent = event.type === "budget_exhausted";
  const reviewDecision = event.type === "review_blocking_detected" || event.type === "review_approved";
  row.className = `event-item ${roleClass}${event.type === "phase_failed" ? " event-phase-failed" : ""}${budgetEvent ? " event-budget" : ""}${reviewDecision ? " event-review-decision" : ""}`;

  const main = document.createElement("div");
  main.className = "event-main";

  const timestamp = document.createElement("span");
  timestamp.className = "event-time";
  timestamp.textContent = `[${event.timestamp}]`;

  const role = document.createElement("span");
  role.className = `event-role ${roleClass}`;
  role.textContent = `[${event.role}]`;

  const type = document.createElement("span");
  type.className = "event-type";
  type.textContent = `${event.type}:`;

  const phaseInfo = document.createElement("span");
  phaseInfo.className = "event-type";
  const iterationText = typeof event.iteration === "number" ? `#${event.iteration}` : "";
  phaseInfo.textContent = event.phase ? `[${event.phase}${iterationText}]` : "";

  const message = document.createElement("span");
  message.className = "event-message";
  message.textContent = event.message;

  main.append(timestamp, role, type, phaseInfo, message);
  row.appendChild(main);

  const artifactId =
    typeof event.artifactId === "string" && event.artifactId.trim()
      ? event.artifactId.trim()
      : typeof event.data?.artifactId === "string" && event.data.artifactId.trim()
        ? event.data.artifactId.trim()
        : "";

  if (artifactId) {
    const artifact = document.createElement("div");
    artifact.className = "event-artifact";
    artifact.textContent = `artifact ${artifactId}`;
    row.appendChild(artifact);
  }

  if (typeof event.data?.summary === "string" && event.data.summary.trim()) {
    const summary = document.createElement("div");
    summary.className = "event-summary";
    summary.textContent = event.data.summary;
    row.appendChild(summary);
  }

  const classification =
    typeof event.classification === "string"
      ? event.classification
      : typeof event.data?.classification === "string"
        ? event.data.classification
        : "";
  if (classification) {
    const badge = document.createElement("div");
    badge.className = `event-classification class-${classification}`;
    badge.textContent = `classification ${classification}`;
    row.appendChild(badge);
  }

  return row;
};

const createPromptRow = (event) => {
  const row = document.createElement("article");
  row.className = "prompt-item";

  const meta = document.createElement("div");
  meta.className = "prompt-meta";
  const iterationText = typeof event.iteration === "number" ? `#${event.iteration}` : "";
  meta.textContent = `[${event.timestamp}] [${event.role}] [${event.phase ?? "-"}${iterationText}]`;
  row.appendChild(meta);

  const body = document.createElement("div");
  body.className = "prompt-body";

  const systemLabel = document.createElement("div");
  systemLabel.className = "prompt-label";
  systemLabel.textContent = "System";
  const systemText = document.createElement("pre");
  systemText.className = "prompt-text";
  systemText.textContent = typeof event.data?.system === "string" ? event.data.system : "(system prompt not available)";

  const userLabel = document.createElement("div");
  userLabel.className = "prompt-label";
  userLabel.textContent = "User";
  const userText = document.createElement("pre");
  userText.className = "prompt-text";
  userText.textContent = typeof event.data?.user === "string" ? event.data.user : "(user prompt not available)";

  body.append(systemLabel, systemText, userLabel, userText);
  row.appendChild(body);

  return row;
};

const renderPromptLogs = () => {
  if (!promptLogsEl) return;
  const shouldStickToBottom = promptLogsEl.scrollHeight - promptLogsEl.scrollTop - promptLogsEl.clientHeight < 24;
  promptLogsEl.replaceChildren();

  const visiblePromptEvents = allEvents.filter(
    (event) => event.type === "prompt_logged" && activeRoleFilters.has(event.role)
  );
  if (visiblePromptEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "events-empty";
    empty.textContent = activeRoleFilters.size === 0 ? "필터가 모두 꺼져 있습니다." : "표시할 프롬프트 로그가 없습니다.";
    promptLogsEl.appendChild(empty);
  } else {
    for (const event of visiblePromptEvents) {
      promptLogsEl.appendChild(createPromptRow(event));
    }
  }

  if (shouldStickToBottom) {
    promptLogsEl.scrollTop = promptLogsEl.scrollHeight;
  }
};

const formatSupervisorLine = (event) => {
  const phaseLabel = event.phase ? `[${event.phase}${typeof event.iteration === "number" ? `#${event.iteration}` : ""}] ` : "";
  const classification =
    typeof event.classification === "string"
      ? ` class=${event.classification}`
      : typeof event.data?.classification === "string"
        ? ` class=${event.data.classification}`
        : "";
  const artifactId =
    typeof event.artifactId === "string" && event.artifactId.trim()
      ? event.artifactId.trim()
      : typeof event.data?.artifactId === "string" && event.data.artifactId.trim()
        ? event.data.artifactId.trim()
        : "";
  const artifact = artifactId ? ` artifact=${artifactId}` : "";
  return `[${event.timestamp}] [${event.role}] ${event.type} ${phaseLabel}${event.message}${classification}${artifact}`;
};

const renderSupervisorMonitor = () => {
  if (!supervisorLogEl) return;

  const includeAdvisor = supervisorIncludeAdvisorInput?.checked ?? true;
  const roles = includeAdvisor ? new Set(["supervisor", "advisor"]) : new Set(["supervisor"]);
  const monitorEvents = allEvents.filter((event) => roles.has(event.role));
  const visibleEvents = monitorEvents.slice(-200);
  const status = activeSessionState?.status ?? "-";
  const iteration = Number.isFinite(activeSessionState?.iteration) ? activeSessionState.iteration : 0;
  const currentPhase = activeSessionState?.currentPhase ?? "-";

  if (supervisorMetaEl) {
    supervisorMetaEl.textContent = `status ${status} | iteration ${iteration} | current ${currentPhase} | events ${visibleEvents.length}/${monitorEvents.length}`;
  }

  if (visibleEvents.length === 0) {
    supervisorLogEl.textContent = includeAdvisor
      ? "Supervisor/Advisor 이벤트가 아직 없습니다."
      : "Supervisor 이벤트가 아직 없습니다.";
    return;
  }

  const shouldStickToBottom = supervisorLogEl.scrollHeight - supervisorLogEl.scrollTop - supervisorLogEl.clientHeight < 24;
  const lines = [];
  for (const event of visibleEvents) {
    lines.push(formatSupervisorLine(event));

    const summary = typeof event.data?.summary === "string" ? event.data.summary.trim() : "";
    if (summary) {
      lines.push(`  summary: ${summary}`);
    }

    const errorMessage = typeof event.data?.errorMessage === "string" ? event.data.errorMessage.trim() : "";
    if (errorMessage) {
      lines.push(`  error: ${errorMessage}`);
    }
  }
  supervisorLogEl.textContent = lines.join("\n");

  if (shouldStickToBottom) {
    supervisorLogEl.scrollTop = supervisorLogEl.scrollHeight;
  }
};

const renderValidationSummary = () => {
  if (!validationSummaryEl) return;

  const validationEvents = allEvents.filter((event) => event.phase === "validation");
  if (validationEvents.length === 0) {
    validationSummaryEl.textContent = "Validation 정보가 아직 없습니다.";
    return;
  }

  const latestResult = [...validationEvents]
    .reverse()
    .find((event) => event.type === "tests_passed" || event.type === "tests_failed");
  const latestArtifact = [...validationEvents]
    .reverse()
    .find((event) => event.type === "artifact_created" && event.role === "test");
  const latestIteration = typeof latestResult?.iteration === "number" ? latestResult.iteration : latestArtifact?.iteration;

  const stepEvents = validationEvents.filter(
    (event) =>
      event.iteration === latestIteration &&
      (event.type === "validation_command_started" ||
        event.type === "validation_command_completed" ||
        event.type === "validation_command_failed")
  );

  const lines = [];
  lines.push(`iteration: ${typeof latestIteration === "number" ? latestIteration : "-"}`);
  lines.push(`artifact: ${latestArtifact?.artifactId ?? "-"}`);
  lines.push(`result: ${latestResult?.type ?? "-"}`);
  const classification =
    latestResult?.classification ??
    (typeof latestResult?.data?.classification === "string" ? latestResult.data.classification : "-");
  lines.push(`classification: ${classification}`);
  lines.push("");
  lines.push("steps:");
  if (stepEvents.length === 0) {
    lines.push("- (no command events)");
  } else {
    for (const event of stepEvents) {
      const stage = typeof event.data?.stage === "string" ? event.data.stage : "?";
      const command = typeof event.data?.command === "string" ? event.data.command : "";
      lines.push(`- ${event.type.replace("validation_command_", "")} [${stage}] ${command}`);
    }
  }

  validationSummaryEl.textContent = lines.join("\n");
};

const renderReviewSummary = () => {
  if (!reviewSummaryEl) return;

  const reviewEvents = allEvents.filter(
    (event) => event.phase === "review" || event.type === "review_blocking_detected" || event.type === "review_approved"
  );
  if (reviewEvents.length === 0) {
    reviewSummaryEl.textContent = "Review 정보가 아직 없습니다.";
    return;
  }

  const latestArtifact = [...reviewEvents]
    .reverse()
    .find((event) => event.type === "artifact_created" && event.role === "reviewer");
  const latestDecision = [...reviewEvents]
    .reverse()
    .find((event) => event.type === "review_blocking_detected" || event.type === "review_approved");

  const lines = [];
  lines.push(`iteration: ${typeof latestDecision?.iteration === "number" ? latestDecision.iteration : "-"}`);
  lines.push(`artifact: ${latestArtifact?.artifactId ?? "-"}`);
  lines.push(`decision: ${latestDecision?.type ?? "-"}`);
  const score =
    typeof latestDecision?.data?.score === "number"
      ? latestDecision.data.score
      : typeof latestArtifact?.data?.score === "number"
        ? latestArtifact.data.score
        : "-";
  lines.push(`score: ${score}`);
  const blockingCount =
    typeof latestArtifact?.data?.blockingCount === "number"
      ? latestArtifact.data.blockingCount
      : Array.isArray(latestDecision?.data?.blockingIssues)
        ? latestDecision.data.blockingIssues.length
        : 0;
  lines.push(`blocking: ${blockingCount}`);
  lines.push("");
  lines.push("fixPlan:");
  if (Array.isArray(latestDecision?.data?.fixPlan) && latestDecision.data.fixPlan.length > 0) {
    for (const step of latestDecision.data.fixPlan) {
      lines.push(`- ${step}`);
    }
  } else {
    lines.push("- (none)");
  }

  reviewSummaryEl.textContent = lines.join("\n");
};

const renderPrPackageSummary = () => {
  if (!prPackageSummaryEl) return;

  if (!activeSessionId) {
    prPackageSummaryEl.textContent = "세션을 선택하면 PR package 정보를 표시합니다.";
    return;
  }

  if (!activePrPackage) {
    prPackageSummaryEl.textContent = "PR Package 정보가 아직 없습니다.";
    return;
  }

  const lines = [];
  lines.push(`artifact: ${activePrPackage.id ?? "-"}`);
  lines.push(`iteration: ${activePrPackage.iteration ?? "-"}`);
  lines.push(`title: ${activePrPackage.title ?? "-"}`);
  lines.push(`outputPath: ${activePrPackage.outputPath ?? "-"}`);
  lines.push(`changedFiles: ${Array.isArray(activePrPackage.changedFiles) ? activePrPackage.changedFiles.length : 0}`);
  lines.push("");
  lines.push("changedFiles:");
  for (const filePath of activePrPackage.changedFiles ?? []) {
    lines.push(`- ${filePath}`);
  }
  lines.push("");
  lines.push("testSummary:");
  lines.push(activePrPackage.testSummary ?? "-");
  lines.push("");
  lines.push("reviewSummary:");
  lines.push(activePrPackage.reviewSummary ?? "-");

  if (Array.isArray(activePrPackage.riskNotes) && activePrPackage.riskNotes.length > 0) {
    lines.push("");
    lines.push("riskNotes:");
    for (const note of activePrPackage.riskNotes) lines.push(`- ${note}`);
  }
  if (Array.isArray(activePrPackage.advisorNotes) && activePrPackage.advisorNotes.length > 0) {
    lines.push("");
    lines.push("advisorNotes:");
    for (const note of activePrPackage.advisorNotes) lines.push(`- ${note}`);
  }

  prPackageSummaryEl.textContent = lines.join("\n");
};

const loadPrPackage = async (sessionId, options = {}) => {
  const { quietNotFound = true } = options;
  if (!sessionId) {
    activePrPackage = null;
    renderPrPackageSummary();
    return null;
  }

  const res = await fetch(`/api/sessions/${sessionId}/pr-package`);
  const body = await res.json().catch(() => ({}));

  if (res.status === 404) {
    activePrPackage = null;
    renderPrPackageSummary();
    if (!quietNotFound) {
      writeDiagnostics("PR Package", "아직 생성되지 않았습니다.");
    }
    return null;
  }

  if (!res.ok) {
    const message = body?.error ? toPrettyJson(body.error) : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  activePrPackage = body.prPackage ?? null;
  renderPrPackageSummary();
  return activePrPackage;
};

const renderBudgetStatus = () => {
  if (!budgetStatusEl) return;

  const budget = activeSessionState?.budget;
  if (!budget) {
    budgetStatusEl.textContent = "Budget 정보가 아직 없습니다.";
    return;
  }

  const lines = [];
  lines.push(`status: ${activeSessionState?.status ?? "-"}`);
  lines.push(`iteration: ${activeSessionState?.iteration ?? 0}`);
  lines.push(`maxIterations: ${budget.maxIterations}`);
  lines.push(`remainingIterations: ${budget.remainingIterations}`);
  lines.push(`maxMinutes: ${budget.maxMinutes}`);
  lines.push(`elapsedMs: ${budget.elapsedMs}`);
  lines.push(`deadlineAt: ${budget.deadlineAt}`);
  lines.push(`exhaustedReason: ${budget.exhaustedReason ?? "-"}`);
  budgetStatusEl.textContent = lines.join("\n");
};

const renderEvents = () => {
  const shouldStickToBottom = eventsEl.scrollHeight - eventsEl.scrollTop - eventsEl.clientHeight < 24;
  eventsEl.replaceChildren();

  const visibleEvents = allEvents.filter((event) => activeRoleFilters.has(event.role));
  if (visibleEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "events-empty";
    empty.textContent = activeRoleFilters.size === 0 ? "필터가 모두 꺼져 있습니다." : "표시할 이벤트가 없습니다.";
    eventsEl.appendChild(empty);
  } else {
    for (const event of visibleEvents) {
      eventsEl.appendChild(createEventRow(event));
    }
  }

  if (shouldStickToBottom) {
    eventsEl.scrollTop = eventsEl.scrollHeight;
  }
  renderSupervisorMonitor();
  renderValidationSummary();
  renderReviewSummary();
  renderPrPackageSummary();
  renderBudgetStatus();
  renderPromptLogs();
};

const appendEvent = (event) => {
  const key = eventKey(event);
  if (seenEventKeys.has(key)) {
    return;
  }

  seenEventKeys.add(key);
  allEvents.push(event);
  renderEvents();
};

const setBusy = (button, busy, busyText, idleText) => {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
};

const fetchJson = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error ? toPrettyJson(body.error) : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body;
};

const startSession = async (payload) => {
  const body = await fetchJson("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await openSession(body.sessionId);
  await loadSessions();
  return body.sessionId;
};

const loadStatus = async (sessionId, options = {}) => {
  const { refreshPrPackage = true } = options;
  const data = await fetchJson(`/api/sessions/${sessionId}`);
  activeSessionState = data.session;
  statusEl.textContent = toPrettyJson(data.session);
  renderPhaseTracker(data.session);
  renderBudgetStatus();
  if (refreshPrPackage) {
    try {
      await loadPrPackage(sessionId, { quietNotFound: true });
    } catch (error) {
      writeDiagnostics("PR Package Error", error instanceof Error ? error.message : String(error));
    }
  }
  return data.session;
};

const connectEventStream = (sessionId) => {
  closeEventStream();

  stream = new EventSource(`/api/sessions/${sessionId}/events`);
  stream.onmessage = async (msg) => {
    const eventData = JSON.parse(msg.data);
    appendEvent(eventData);
    const session = await loadStatus(sessionId);
    if (isTerminalSessionStatus(session.status)) {
      closeEventStream();
    }
    await loadSessions();
  };

  stream.onerror = async () => {
    try {
      const session = await loadStatus(sessionId);
      if (isTerminalSessionStatus(session.status)) {
        closeEventStream();
        await loadSessions();
        return;
      }
    } catch {
      // keep existing stream_error behavior below
    }

    appendEvent({
      timestamp: now(),
      role: "supervisor",
      type: "stream_error",
      message: "SSE connection dropped."
    });
  };
};

const openSession = async (sessionId) => {
  activeSessionId = sessionId;
  activePrPackage = null;
  allEvents.length = 0;
  seenEventKeys.clear();
  renderEvents();

  const detail = await fetchJson(`/api/sessions/${sessionId}`);
  activeSessionState = detail.session;
  statusEl.textContent = toPrettyJson(detail.session);
  renderPhaseTracker(detail.session);
  renderBudgetStatus();
  await loadPrPackage(sessionId, { quietNotFound: true });
  for (const event of detail.events) {
    appendEvent(event);
  }

  connectEventStream(sessionId);
};

const createStatusBadge = (status) => {
  const span = document.createElement("span");
  span.className = `badge ${status === "success" ? "ok" : status === "failed" ? "fail" : ""}`;
  span.textContent = status;
  return span;
};

const loadSessions = async () => {
  const data = await fetchJson("/api/sessions");
  sessionsListEl.replaceChildren();

  if (data.sessions.length === 0) {
    sessionsListEl.textContent = "아직 세션이 없습니다.";
    return;
  }

  for (const session of data.sessions) {
    const card = document.createElement("article");
    card.className = "session-item";

    const row = document.createElement("div");
    row.className = "session-meta";
    const iteration = Number.isFinite(session.iteration) ? session.iteration : session.attempt;
    const currentPhase = typeof session.currentPhase === "string" ? ` | phase ${session.currentPhase}` : "";
    row.textContent = `${session.id.slice(0, 8)} | iteration ${iteration}${currentPhase} | ${new Date(session.startedAt).toLocaleString()}`;

    const topic = document.createElement("div");
    topic.className = "session-meta";
    const topicText =
      (typeof session.input.topic === "string" && session.input.topic.trim()) ||
      (typeof session.input.task === "string" && session.input.task.trim()) ||
      "(no topic)";
    topic.textContent = `${topicText} | workspace=${session.input.workspaceRoot ?? defaultWorkspaceRoot} | autonomous=${session.input.autonomous !== false}`;

    const badge = createStatusBadge(session.status);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "button";
    const isWatching = activeSessionId === session.id && Boolean(stream) && !isTerminalSessionStatus(session.status);
    openBtn.textContent = isWatching ? "Watching" : "Open";
    openBtn.disabled = isWatching;
    openBtn.addEventListener("click", async () => {
      await openSession(session.id);
      await loadSessions();
    });

    card.appendChild(row);
    card.appendChild(topic);
    card.appendChild(badge);
    card.appendChild(openBtn);
    sessionsListEl.appendChild(card);
  }
};

const refreshOverview = async () => {
  setBusy(refreshOverviewBtn, true, "Loading...", "Refresh");
  try {
    const [health, overview] = await Promise.all([fetchJson("/api/health"), fetchJson("/api/tools/overview")]);
    applyWorkspaceRootDefault(overview?.workspaceRoot);
    writeDiagnostics("Overview", { health, overview });
  } catch (error) {
    writeDiagnostics("Overview Error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(refreshOverviewBtn, false, "Loading...", "Refresh");
  }
};

const pingHealth = async () => {
  setBusy(pingHealthBtn, true, "Checking...", "App Health");
  try {
    const health = await fetchJson("/api/health");
    writeDiagnostics("App Health", health);
  } catch (error) {
    writeDiagnostics("App Health Error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(pingHealthBtn, false, "Checking...", "App Health");
  }
};

const pingLlm = async () => {
  setBusy(pingLlmBtn, true, "Pinging...", "LLM Ping");
  try {
    const payload = { prompt: pingPromptInput.value.trim() || "Respond with one short line: pong" };
    const result = await fetchJson("/api/tools/llm/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    writeDiagnostics("LLM Ping", result);
  } catch (error) {
    writeDiagnostics("LLM Ping Error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(pingLlmBtn, false, "Pinging...", "LLM Ping");
  }
};

const runCommand = async () => {
  setBusy(runCommandBtn, true, "Running...", "Run");
  try {
    const payload = { command: commandInput.value.trim() || "pnpm test" };
    const result = await fetchJson("/api/tools/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    writeDiagnostics("Command Result", result);
  } catch (error) {
    writeDiagnostics("Command Error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(runCommandBtn, false, "Running...", "Run");
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const startBtn = document.getElementById("start-session");
  setBusy(startBtn, true, "Starting...", "Start Session");

  try {
    const validationCommands = parseValidationCommands(validationCommandsInput.value);
    const trimmedTestCommand = testInput.value.trim();
    const topicValue = topicInput.value.trim();
    const workspaceRootValue = workspaceRootInput?.value.trim() || defaultWorkspaceRoot;
    const taskValue = taskInput.value.trim();
    const filePaths = filesInput.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!topicValue && !taskValue) {
      throw new Error("topic 또는 task 중 하나는 필수입니다.");
    }
    if (filePaths.length === 0) {
      throw new Error("filePaths는 최소 1개 이상 필요합니다.");
    }
    if (!trimmedTestCommand && validationCommands.length === 0) {
      throw new Error("testCommand 또는 validationCommands 중 하나는 필수입니다.");
    }
    const parsedMaxMinutes = Number.parseInt(maxMinutesInput.value || "45", 10);
    const parsedMaxIterations = Number.parseInt(maxIterationsInput.value || "6", 10);

    const payload = {
      topic: topicValue || undefined,
      task: taskValue || undefined,
      autonomous: autonomousInput.checked,
      workspaceRoot: workspaceRootValue,
      filePaths,
      testCommand: trimmedTestCommand || undefined,
      validationCommands: validationCommands.length > 0 ? validationCommands : undefined,
      maxMinutes: Number.isFinite(parsedMaxMinutes) ? parsedMaxMinutes : 45
    };
    const maxIterations = Number.isFinite(parsedMaxIterations) ? parsedMaxIterations : 6;
    if (activePresetConfig?.useLegacyMaxAttempts) {
      payload.maxAttempts = maxIterations;
    } else {
      payload.maxIterations = maxIterations;
    }

    const sessionId = await startSession(payload);
    writeDiagnostics("Session Started", { sessionId });
  } catch (error) {
    writeDiagnostics("Session Error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(startBtn, false, "Starting...", "Start Session");
  }
});

if (quickTopicForm) {
  quickTopicForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!quickTopicRunBtn) return;

    setBusy(quickTopicRunBtn, true, "Starting...", "Start Quick Run");
    try {
      const topic = quickTopicInput?.value.trim() ?? "";
      if (!topic) {
        throw new Error("Quick Run은 topic 입력이 필요합니다.");
      }

      const nextLikeRequest = shouldUseNextQuickDefaults(topic);
      const filePaths = nextLikeRequest ? quickNextDefaults.filePaths : quickRunDefaults.filePaths;
      const validationCommands = nextLikeRequest ? quickNextDefaults.validationCommands : quickRunDefaults.validationCommands;

      const payload = {
        topic,
        workspaceRoot: quickWorkspaceRootInput?.value.trim() || defaultWorkspaceRoot,
        autonomous: quickTopicAutonomousInput?.checked ?? true,
        filePaths,
        validationCommands,
        maxIterations: quickRunDefaults.maxIterations,
        maxMinutes: quickRunDefaults.maxMinutes
      };

      const sessionId = await startSession(payload);
      writeDiagnostics("Quick Topic Session Started", { sessionId, topic, ...payload });
    } catch (error) {
      writeDiagnostics("Quick Topic Session Error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(quickTopicRunBtn, false, "Starting...", "Start Quick Run");
    }
  });
}

refreshOverviewBtn.addEventListener("click", refreshOverview);
pingHealthBtn.addEventListener("click", pingHealth);
pingLlmBtn.addEventListener("click", pingLlm);
runCommandBtn.addEventListener("click", runCommand);
if (refreshPrPackageBtn) {
  refreshPrPackageBtn.addEventListener("click", () => {
    if (!activeSessionId) {
      writeDiagnostics("PR Package", "먼저 세션을 선택하세요.");
      return;
    }
    loadPrPackage(activeSessionId, { quietNotFound: false })
      .then((prPackage) => {
        if (prPackage) {
          writeDiagnostics("PR Package", {
            title: prPackage.title,
            outputPath: prPackage.outputPath,
            changedFiles: prPackage.changedFiles
          });
        }
      })
      .catch((error) => {
        writeDiagnostics("PR Package Error", error instanceof Error ? error.message : String(error));
      });
  });
}
if (supervisorIncludeAdvisorInput) {
  supervisorIncludeAdvisorInput.addEventListener("change", () => {
    renderSupervisorMonitor();
  });
}
for (const input of roleFilterInputs) {
  input.addEventListener("change", () => {
    if (input.checked) {
      activeRoleFilters.add(input.value);
    } else {
      activeRoleFilters.delete(input.value);
    }
    renderEvents();
  });
}

refreshSessionsBtn.addEventListener("click", () => {
  loadSessions().catch((error) => {
    writeDiagnostics("Session List Error", error instanceof Error ? error.message : String(error));
  });
});

renderEvents();
renderPhaseTracker(null);
renderPrPackageSummary();
renderSupervisorMonitor();
initSessionPresets();

refreshOverview().catch((error) => {
  writeDiagnostics("Overview Error", error instanceof Error ? error.message : String(error));
});

loadSessions().catch((error) => {
  writeDiagnostics("Session List Error", error instanceof Error ? error.message : String(error));
});
