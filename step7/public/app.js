const form = document.getElementById("session-form");
const statusEl = document.getElementById("status");
const phaseTrackerEl = document.getElementById("phase-tracker");
const phaseMetaEl = document.getElementById("phase-meta");
const goalValidationSummaryEl = document.getElementById("goal-validation-summary");
const validationSummaryEl = document.getElementById("validation-summary");
const validationGuidanceEl = document.getElementById("validation-guidance");
const reviewSummaryEl = document.getElementById("review-summary");
const prPackageSummaryEl = document.getElementById("pr-package-summary");
const commandCenterEl = document.getElementById("command-center");
const commandCenterMetaEl = document.getElementById("command-center-meta");
const budgetStatusEl = document.getElementById("budget-status");
const promptLogsEl = document.getElementById("prompt-logs");
const supervisorLogEl = document.getElementById("supervisor-log");
const supervisorMetaEl = document.getElementById("supervisor-meta");
const eventsEl = document.getElementById("events");
const sessionsListEl = document.getElementById("sessions-list");
const diagnosticsEl = document.getElementById("diagnostics-output");
const chatMetaEl = document.getElementById("chat-meta");
const chatMessagesEl = document.getElementById("chat-messages");
const chatMessageForm = document.getElementById("chat-message-form");
const chatMessageInput = document.getElementById("chat-message-input");
const chatWorkspaceRootInput = document.getElementById("chat-workspace-root");
const chatAutonomousInput = document.getElementById("chat-autonomous");
const chatApprovalModeInput = document.getElementById("chat-approval-mode");
const taskBoardEl = document.getElementById("task-board");
const decompositionMetaEl = document.getElementById("decomposition-meta");
const decompositionLogEl = document.getElementById("decomposition-log");
const parallelMonitorEl = document.getElementById("parallel-monitor");
const parallelTimelineEl = document.getElementById("parallel-timeline");
const parallelMetaEl = document.getElementById("parallel-meta");
const handoffsPanelEl = document.getElementById("handoffs-panel");
const discoveryPanelEl = document.getElementById("discovery-panel");
const approvalPanelEl = document.getElementById("approval-panel");
const workerLogEl = document.getElementById("worker-log");

const refreshOverviewBtn = document.getElementById("refresh-overview");
const pingHealthBtn = document.getElementById("ping-health");
const pingLlmBtn = document.getElementById("ping-llm");
const runCommandBtn = document.getElementById("run-command");
const refreshSessionsBtn = document.getElementById("refresh-sessions");
const refreshPrPackageBtn = document.getElementById("refresh-pr-package");
const supervisorIncludeAdvisorInput = document.getElementById("supervisor-include-advisor");
const createChatSessionBtn = document.getElementById("create-chat-session");
const refreshChatSessionBtn = document.getElementById("refresh-chat-session");
const sendChatMessageBtn = document.getElementById("send-chat-message");
const uiModeMetaEl = document.getElementById("ui-mode-meta");
const uiModeTeamBtn = document.getElementById("ui-mode-team");
const uiModeDebugBtn = document.getElementById("ui-mode-debug");

const pingPromptInput = document.getElementById("ping-prompt");
const commandInput = document.getElementById("tool-command");
const presetSelect = document.getElementById("session-preset");
const presetHelp = document.getElementById("session-preset-help");
const presetPreviewEl = document.getElementById("session-preset-preview");
const topicInput = document.getElementById("topic");
const workspaceRootInput = document.getElementById("workspaceRoot");
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
let chatStream;
let activeChatSessionId = "";
let activeChatSessionState = null;
let activeChatMessages = [];
let activeTasks = [];
let activeHandoffs = [];
let activeDiscovery = null;
let activeApprovals = [];
let openSessionRequestVersion = 0;
let loadStatusRequestVersion = 0;
let loadTeamPanelsRequestVersion = 0;
let loadPrPackageRequestVersion = 0;
const allEvents = [];
const seenEventKeys = new Set();
const activeRoleFilters = new Set(roleFilterInputs.filter((input) => input.checked).map((input) => input.value));

const now = () => new Date().toISOString();
const isTerminalSessionStatus = (status) => status === "success" || status === "failed";
const isActiveSession = (sessionId) => typeof sessionId === "string" && sessionId.length > 0 && sessionId === activeSessionId;

const closeEventStream = () => {
  if (!stream) return;
  stream.close();
  stream = undefined;
};

const closeChatStream = () => {
  if (!chatStream) return;
  chatStream.close();
  chatStream = undefined;
};

const toPrettyJson = (value) => JSON.stringify(value, null, 2);
const phaseOrder = ["planning", "architecture", "design", "implementation", "goal_validation", "validation", "review", "packaging"];
const loopPhases = new Set(["implementation", "goal_validation", "validation", "review"]);
const configuredMaxParallelWorkers = 3;
const uiModeStorageKey = "step7_ui_mode";

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
  if (chatWorkspaceRootInput && isWorkspaceDefaultPlaceholder(chatWorkspaceRootInput.value)) {
    chatWorkspaceRootInput.value = normalized;
  }
};

const normalizeApprovalMode = (value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "auto_safe" || normalized === "auto_all" || normalized === "manual") {
    return normalized;
  }
  return "manual";
};

const normalizeUiMode = (value) => (value === "debug" ? "debug" : "team");

const applyUiMode = (modeInput) => {
  const mode = normalizeUiMode(modeInput);
  document.body.dataset.uiMode = mode;
  if (uiModeMetaEl) {
    uiModeMetaEl.textContent = mode === "debug" ? "Debug mode (all panels)" : "Team mode (focused)";
  }

  if (uiModeTeamBtn) {
    const active = mode === "team";
    uiModeTeamBtn.classList.toggle("is-active", active);
    uiModeTeamBtn.setAttribute("aria-pressed", String(active));
  }
  if (uiModeDebugBtn) {
    const active = mode === "debug";
    uiModeDebugBtn.classList.toggle("is-active", active);
    uiModeDebugBtn.setAttribute("aria-pressed", String(active));
  }

  try {
    localStorage.setItem(uiModeStorageKey, mode);
  } catch {
    // ignore storage errors
  }
};

const getInitialUiMode = () => {
  try {
    return normalizeUiMode(localStorage.getItem(uiModeStorageKey));
  } catch {
    return "team";
  }
};

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

const formatPhaseLabel = (phase) =>
  phase
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

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

const toNonEmptyString = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");
const toCommandList = (value) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];

const renderValidationGuidance = () => {
  if (!validationGuidanceEl) return;

  if (!activeSessionId) {
    validationGuidanceEl.textContent = "세션을 선택하면 validation guidance 원문을 표시합니다.";
    return;
  }

  const latestPlanEvent = [...allEvents]
    .reverse()
    .find((event) => event.type === "validation_plan_created" && event.role === "supervisor");

  const guidanceFromInput = toNonEmptyString(activeSessionState?.input?.validationGuidance);
  const guidanceFromEvent = toNonEmptyString(latestPlanEvent?.data?.guidance);
  const commandsFromInput = toCommandList(activeSessionState?.input?.validationCommands);
  const commandsFromEvent = toCommandList(latestPlanEvent?.data?.commands);

  const guidance = guidanceFromInput || guidanceFromEvent;
  const commands = commandsFromInput.length > 0 ? commandsFromInput : commandsFromEvent;

  if (!guidance && commands.length === 0) {
    validationGuidanceEl.textContent =
      "아직 생성된 validation guidance가 없습니다.\nrun 준비 단계에서 validation_plan_created 이벤트가 생성되면 여기에 표시됩니다.";
    return;
  }

  const lines = [];
  lines.push(
    `source: ${
      guidanceFromInput
        ? "session.input.validationGuidance"
        : guidanceFromEvent
          ? "event(validation_plan_created)"
          : "unknown"
    }`
  );
  lines.push(`status: ${activeSessionState?.status ?? "-"}`);
  lines.push(`phase: ${activeSessionState?.currentPhase ?? "-"}`);
  if (typeof latestPlanEvent?.timestamp === "string") {
    lines.push(`plannedAt: ${latestPlanEvent.timestamp}`);
  }
  lines.push("");
  lines.push("guidance:");
  lines.push(guidance || "-");
  lines.push("");
  lines.push("commands:");
  if (commands.length === 0) {
    lines.push("- (none)");
  } else {
    for (const [index, command] of commands.entries()) {
      lines.push(`${index + 1}. ${command}`);
    }
  }

  validationGuidanceEl.textContent = lines.join("\n");
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

const renderChatPanel = () => {
  if (chatMetaEl) {
    if (!activeChatSessionState) {
      chatMetaEl.textContent = "chat session not selected";
    } else {
      const runId = activeChatSessionState.activeRunId ? activeChatSessionState.activeRunId.slice(0, 8) : "-";
      chatMetaEl.textContent = `chat ${activeChatSessionState.id.slice(0, 8)} | run ${runId} | autonomous=${activeChatSessionState.autonomous} | approval=${activeChatSessionState.approvalMode ?? "manual"}`;
    }
  }

  if (!chatMessagesEl) return;

  chatMessagesEl.replaceChildren();
  if (!activeChatMessages || activeChatMessages.length === 0) {
    chatMessagesEl.textContent = "아직 대화가 없습니다.";
    return;
  }

  const shouldStickToBottom = chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight < 24;
  for (const message of activeChatMessages) {
    const row = document.createElement("div");
    row.className = "chat-line";

    const role = document.createElement("span");
    role.className = "chat-role";
    role.textContent = `[${message.role}]`;

    const content = document.createElement("span");
    content.textContent = message.content;

    row.append(role, content);
    chatMessagesEl.appendChild(row);
  }

  if (shouldStickToBottom) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
};

const taskBoardColumns = [
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked/Failed" },
  { key: "done", label: "Done" }
];

const taskToColumn = (task) => {
  if (task.status === "failed") return "blocked";
  return task.status;
};

const taskStatusBadgeLabel = (status) => {
  if (status === "failed") return "FAILED";
  if (status === "blocked") return "BLOCKED";
  if (status === "running") return "RUNNING";
  if (status === "done") return "DONE";
  if (status === "review") return "REVIEW";
  return "QUEUED";
};

const summarizeTaskFiles = (task) => {
  const files = Array.isArray(task.targetFiles) ? task.targetFiles.filter(Boolean) : [];
  if (files.length === 0) return "파일 대상 없음";
  const preview = files.slice(0, 3);
  const rest = files.length - preview.length;
  return rest > 0 ? `${preview.join(", ")} (+${rest})` : preview.join(", ");
};

const createTaskPill = (label, className) => {
  const pill = document.createElement("span");
  pill.className = `task-pill ${className}`;
  pill.textContent = label;
  return pill;
};

const createSupervisorLoopFailureTask = () => {
  if (!activeSessionState) return null;
  const existingFailureTask = Array.isArray(activeTasks)
    ? activeTasks.some((task) => task?.assignee === "supervisor" && task?.status === "failed")
    : false;
  if (existingFailureTask) return null;

  const phaseStatuses = activeSessionState.phaseStatuses ?? {};
  const failedPhases = phaseOrder.filter((phase) => phaseStatuses[phase] === "failed");
  if (failedPhases.length === 0 && activeSessionState.status !== "failed") {
    return null;
  }

  const failedPhase = failedPhases[0] ?? activeSessionState.currentPhase ?? "unknown";
  const latestFailureEvent = [...allEvents]
    .reverse()
    .find((event) => event.type === "phase_failed" && (event.phase === failedPhase || !event.phase));
  const failureReason =
    (typeof latestFailureEvent?.data?.errorMessage === "string" && latestFailureEvent.data.errorMessage.trim()) ||
    (typeof latestFailureEvent?.message === "string" && latestFailureEvent.message.trim()) ||
    (typeof activeSessionState.finalSummary === "string" && activeSessionState.finalSummary.trim()) ||
    `Supervisor loop failed at ${failedPhase} phase.`;

  return {
    id: `supervisor-loop-failure-${activeSessionId || "unknown"}`,
    runId: activeSessionId || "unknown",
    title: `Supervisor Loop Failure (${failedPhase})`,
    objective: "Supervisor loop execution",
    phase: failedPhase,
    status: "failed",
    assignee: "supervisor",
    dependencies: [],
    targetFiles: [],
    acceptanceCriteria: [],
    commands: [],
    retries: 0,
    createdAt: latestFailureEvent?.timestamp ?? now(),
    updatedAt: latestFailureEvent?.timestamp ?? now(),
    summary: failureReason,
    synthetic: true
  };
};

const renderTaskBoard = () => {
  if (!taskBoardEl) return;
  taskBoardEl.replaceChildren();

  const baseTasks = Array.isArray(activeTasks) ? activeTasks : [];
  const loopFailureTask = createSupervisorLoopFailureTask();
  const boardTasks = loopFailureTask ? [...baseTasks, loopFailureTask] : baseTasks;

  if (boardTasks.length === 0) {
    taskBoardEl.textContent = "Task graph가 아직 생성되지 않았습니다.";
    return;
  }

  const summary = document.createElement("div");
  summary.className = "task-board-summary";
  const summaryStats = [
    { label: "Total", value: boardTasks.length, className: "total" },
    { label: "Queued", value: boardTasks.filter((task) => taskToColumn(task) === "queued").length, className: "queued" },
    { label: "Running", value: boardTasks.filter((task) => taskToColumn(task) === "running").length, className: "running" },
    { label: "Blocked", value: boardTasks.filter((task) => taskToColumn(task) === "blocked").length, className: "blocked" },
    { label: "Done", value: boardTasks.filter((task) => taskToColumn(task) === "done").length, className: "done" }
  ];
  for (const stat of summaryStats) {
    const chip = document.createElement("span");
    chip.className = `task-summary-chip ${stat.className}`;
    chip.textContent = `${stat.label}: ${stat.value}`;
    summary.appendChild(chip);
  }
  taskBoardEl.appendChild(summary);

  const currentPhase = activeSessionState?.currentPhase ?? "-";
  const currentIteration = Number.isFinite(activeSessionState?.iteration) ? activeSessionState.iteration : 0;
  const context = document.createElement("div");
  context.className = "task-board-context";
  context.textContent = `scope: team orchestration stage | current phase: ${currentPhase} | iteration: ${currentIteration}`;
  taskBoardEl.appendChild(context);

  const doneCount = summaryStats.find((item) => item.label === "Done")?.value ?? 0;
  if (doneCount === boardTasks.length && boardTasks.length > 0 && currentPhase !== "implementation") {
    const hint = document.createElement("div");
    hint.className = "task-board-hint";
    hint.textContent =
      "Task Board는 초기 worker/coordinator 작업 상태를 표시합니다. 현재 phase 진행은 Phase Tracker를 기준으로 계속됩니다.";
    taskBoardEl.appendChild(hint);
  }

  for (const column of taskBoardColumns) {
    const group = boardTasks.filter((task) => taskToColumn(task) === column.key);
    const section = document.createElement("section");
    section.className = `task-column task-column-${column.key}`;

    const title = document.createElement("h3");
    title.textContent = `${column.label} (${group.length})`;
    section.appendChild(title);

    if (group.length === 0) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "항목 없음";
      section.appendChild(empty);
    } else {
      for (const task of group) {
        const item = document.createElement("article");
        item.className = `task-item status-${task.status}`;

        const heading = document.createElement("div");
        heading.className = "task-title";
        heading.textContent = task.title;

        const meta = document.createElement("div");
        meta.className = "task-item-meta";
        meta.append(
          createTaskPill(task.assignee, `role role-${task.assignee}`),
          createTaskPill(taskStatusBadgeLabel(task.status), `status status-${task.status}`)
        );

        const files = document.createElement("div");
        files.className = "task-files";
        files.textContent = summarizeTaskFiles(task);

        item.append(heading, meta, files);
        if (typeof task.summary === "string" && task.summary.trim()) {
          const summary = document.createElement("div");
          summary.className = `task-reason status-${task.status}`;
          summary.textContent = `reason: ${task.summary.trim()}`;
          item.append(summary);
        }
        section.appendChild(item);
      }
    }

    taskBoardEl.appendChild(section);
  }
};

const renderTaskDecomposition = () => {
  if (!decompositionMetaEl || !decompositionLogEl) return;

  if (!activeSessionId) {
    decompositionMetaEl.textContent = "No run selected.";
    decompositionLogEl.textContent = "세션을 선택하면 작업 분해 로그를 표시합니다.";
    return;
  }

  const decomposeEvents = allEvents
    .filter(
      (event) =>
        event.type === "task_scheduled" ||
        event.type === "discovery_started" ||
        event.type === "discovery_completed" ||
        event.type === "task_decomposed" ||
        event.type === "handoff_created"
    )
    .slice();

  const latestTaskDecomposed = [...decomposeEvents].reverse().find((event) => event.type === "task_decomposed");
  const taskCount =
    typeof latestTaskDecomposed?.data?.taskCount === "number" ? latestTaskDecomposed.data.taskCount : activeTasks.length;
  const edgeCount =
    typeof latestTaskDecomposed?.data?.edgeCount === "number"
      ? latestTaskDecomposed.data.edgeCount
      : Math.max(0, activeTasks.filter((task) => Array.isArray(task.dependencies) && task.dependencies.length > 0).length);
  const workerTasks = activeTasks.filter((task) => task.assignee === "worker");
  const coordinatorTasks = activeTasks.filter((task) => task.assignee === "coordinator");

  decompositionMetaEl.textContent = `run ${activeSessionId.slice(0, 8)} | tasks ${taskCount} | edges ${edgeCount} | workers ${workerTasks.length} | coordinator ${coordinatorTasks.length}`;

  const lines = [];
  lines.push("event timeline:");
  if (decomposeEvents.length === 0) {
    lines.push("- task decomposition event가 아직 없습니다.");
  } else {
    for (const event of decomposeEvents.slice(-80)) {
      const data = event.data ?? {};
      const detail =
        event.type === "task_decomposed"
          ? ` taskCount=${data.taskCount ?? "-"} edgeCount=${data.edgeCount ?? "-"}`
          : event.type === "discovery_completed"
            ? ` indexed=${data.indexedCount ?? "-"} selected=${Array.isArray(data.selectedFiles) ? data.selectedFiles.length : "-"}`
            : "";
      lines.push(`- [${event.timestamp}] ${event.type}:${detail}`);
    }
  }

  lines.push("");
  lines.push("decomposed tasks:");
  if (!Array.isArray(activeTasks) || activeTasks.length === 0) {
    lines.push("- task graph가 아직 생성되지 않았습니다.");
  } else {
    for (const task of activeTasks) {
      const deps = Array.isArray(task.dependencies) && task.dependencies.length > 0 ? task.dependencies.map((id) => id.slice(0, 8)).join(", ") : "-";
      const files = Array.isArray(task.targetFiles) && task.targetFiles.length > 0 ? task.targetFiles.join(", ") : "-";
      lines.push(`- ${task.title} (${task.id.slice(0, 8)})`);
      lines.push(`  assignee=${task.assignee} phase=${task.phase} status=${task.status}`);
      lines.push(`  deps=${deps}`);
      lines.push(`  files=${files}`);
      if (typeof task.summary === "string" && task.summary.trim()) {
        lines.push(`  summary=${task.summary.trim()}`);
      }
    }
  }

  decompositionLogEl.textContent = lines.join("\n");
};

const parallelEventTypes = new Set([
  "task_started",
  "task_completed",
  "task_blocked",
  "task_failed",
  "worker_command_started",
  "worker_command_completed",
  "worker_command_failed"
]);

const getParallelSnapshot = () => {
  const workerTasks = Array.isArray(activeTasks) ? activeTasks.filter((task) => task.assignee === "worker") : [];
  const runningTasks = workerTasks.filter((task) => task.status === "running");
  const queuedTasks = workerTasks.filter((task) => task.status === "queued");
  const doneTasks = workerTasks.filter((task) => task.status === "done");
  const blockedTasks = workerTasks.filter((task) => task.status === "blocked" || task.status === "failed");

  const workerEvents = allEvents
    .filter((event) => (event.role === "worker" || event.role === "coordinator") && parallelEventTypes.has(event.type))
    .slice()
    .sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));

  const runningTaskIds = new Set();
  let maxObservedParallel = 0;
  const timeline = [];

  for (const event of workerEvents) {
    const taskId = typeof event.data?.taskId === "string" ? event.data.taskId : "";
    if (taskId) {
      if (event.type === "task_started") {
        runningTaskIds.add(taskId);
      } else if (event.type === "task_completed" || event.type === "task_blocked" || event.type === "task_failed") {
        runningTaskIds.delete(taskId);
      }
    }
    maxObservedParallel = Math.max(maxObservedParallel, runningTaskIds.size);
    const commandText = typeof event.data?.command === "string" ? ` | ${event.data.command}` : "";
    timeline.push(
      `[${event.timestamp}] ${event.type} ${taskId ? taskId.slice(0, 8) : "-"}${commandText} | running=${runningTaskIds.size}`
    );
  }

  return {
    workerTasks,
    runningTasks,
    queuedTasks,
    doneTasks,
    blockedTasks,
    maxObservedParallel,
    timeline
  };
};

const renderParallelMonitor = () => {
  if (!parallelMonitorEl || !parallelTimelineEl || !parallelMetaEl) return;

  if (!activeSessionId) {
    parallelMetaEl.textContent = "No run selected.";
    parallelMonitorEl.textContent = "세션을 선택하면 병렬 워커 상태를 표시합니다.";
    parallelTimelineEl.textContent = "병렬 이벤트 타임라인이 아직 없습니다.";
    return;
  }

  const snapshot = getParallelSnapshot();
  const total = snapshot.workerTasks.length;
  const running = snapshot.runningTasks.length;
  const queued = snapshot.queuedTasks.length;
  const done = snapshot.doneTasks.length;
  const blocked = snapshot.blockedTasks.length;
  const maxObserved = snapshot.maxObservedParallel;
  const peakUtilizationBase = Math.min(configuredMaxParallelWorkers, Math.max(total, 1));
  const peakUtilization = Math.round((maxObserved / peakUtilizationBase) * 100);

  parallelMetaEl.textContent = `run ${activeSessionId.slice(0, 8)} | running ${running} | max observed ${maxObserved} | configured ${configuredMaxParallelWorkers}`;

  parallelMonitorEl.replaceChildren();
  const stats = [
    { label: "Worker Tasks", value: String(total) },
    { label: "Running Now", value: String(running) },
    { label: "Queued", value: String(queued) },
    { label: "Done", value: String(done) },
    { label: "Blocked/Failed", value: String(blocked) },
    { label: "Configured Parallel", value: String(configuredMaxParallelWorkers) },
    { label: "Max Observed Parallel", value: String(maxObserved) },
    { label: "Peak Utilization", value: `${peakUtilization}%` }
  ];

  for (const stat of stats) {
    const card = document.createElement("article");
    card.className = "parallel-stat";

    const label = document.createElement("div");
    label.className = "parallel-stat-label";
    label.textContent = stat.label;

    const value = document.createElement("div");
    value.className = "parallel-stat-value";
    value.textContent = stat.value;

    card.append(label, value);
    parallelMonitorEl.appendChild(card);
  }

  const lines = [];
  if (snapshot.runningTasks.length > 0) {
    lines.push("running tasks:");
    for (const task of snapshot.runningTasks) {
      const files = Array.isArray(task.targetFiles) ? task.targetFiles.slice(0, 3).join(", ") : "";
      lines.push(`- ${task.title} (${task.id.slice(0, 8)})${files ? ` | ${files}` : ""}`);
    }
    lines.push("");
  }

  lines.push("parallel timeline:");
  if (snapshot.timeline.length === 0) {
    lines.push("- worker 이벤트가 아직 없습니다.");
  } else {
    for (const line of snapshot.timeline.slice(-120)) {
      lines.push(`- ${line}`);
    }
  }
  parallelTimelineEl.textContent = lines.join("\n");
};

const renderHandoffsPanel = () => {
  if (!handoffsPanelEl) return;
  if (!Array.isArray(activeHandoffs) || activeHandoffs.length === 0) {
    handoffsPanelEl.textContent = "handoff 데이터가 없습니다.";
    return;
  }

  const lines = [];
  for (const handoff of activeHandoffs) {
    lines.push(`${handoff.id.slice(0, 8)} | ${handoff.status} | ${handoff.fromTaskId.slice(0, 8)} -> ${handoff.toTaskId.slice(0, 8)}`);
    lines.push(`reason: ${handoff.reason}`);
    lines.push("");
  }
  handoffsPanelEl.textContent = lines.join("\n");
};

const renderDiscoveryPanel = () => {
  if (!discoveryPanelEl) return;
  if (!activeDiscovery) {
    discoveryPanelEl.textContent = "discovery 결과가 없습니다.";
    return;
  }

  const lines = [];
  lines.push(`workspaceRoot: ${activeDiscovery.workspaceRoot}`);
  lines.push(`selectedFiles: ${(activeDiscovery.selectedFiles ?? []).length}`);
  lines.push(`reasoning: ${activeDiscovery.reasoning ?? "-"}`);
  lines.push("");
  lines.push("selected:");
  for (const filePath of activeDiscovery.selectedFiles ?? []) {
    lines.push(`- ${filePath}`);
  }
  lines.push("");
  lines.push("top candidates:");
  for (const candidate of (activeDiscovery.candidates ?? []).slice(0, 12)) {
    lines.push(`- ${candidate.path} (${candidate.score}) ${Array.isArray(candidate.reasons) ? candidate.reasons.join(", ") : ""}`);
  }
  discoveryPanelEl.textContent = lines.join("\n");
};

const submitApprovalDecision = async (approvalId, decision) => {
  const note = window.prompt(`Approval ${decision} note (optional)`, "") ?? "";
  await fetchJson(`/api/approvals/${approvalId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note: note.trim() || undefined })
  });
  await loadTeamPanels(activeSessionId);
  await loadStatus(activeSessionId);
};

const renderApprovalsPanel = () => {
  if (!approvalPanelEl) return;
  approvalPanelEl.replaceChildren();

  if (!Array.isArray(activeApprovals) || activeApprovals.length === 0) {
    approvalPanelEl.textContent = "pending approval이 없습니다.";
    return;
  }

  for (const approval of activeApprovals) {
    const item = document.createElement("article");
    item.className = "approval-item";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = `${approval.id.slice(0, 8)} | ${approval.riskLevel} | ${approval.status}`;

    const reason = document.createElement("div");
    reason.className = "task-meta";
    reason.textContent = approval.reason;

    const command = document.createElement("div");
    command.className = "approval-command";
    command.textContent = approval.command;

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "button";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => {
      submitApprovalDecision(approval.id, "approve").catch((error) => {
        writeDiagnostics("Approval Error", error instanceof Error ? error.message : String(error));
      });
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "button danger";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => {
      submitApprovalDecision(approval.id, "reject").catch((error) => {
        writeDiagnostics("Approval Error", error instanceof Error ? error.message : String(error));
      });
    });

    actions.append(approveBtn, rejectBtn);
    item.append(title, reason, command, actions);
    approvalPanelEl.appendChild(item);
  }
};

const renderWorkerLog = () => {
  if (!workerLogEl) return;

  const lines = allEvents
    .filter((event) => event.role === "worker" || event.role === "coordinator" || event.role === "discoverer" || parallelEventTypes.has(event.type))
    .slice(-200)
    .map((event) => `[${event.timestamp}] [${event.role}] ${event.type}: ${event.message}`);

  workerLogEl.textContent = lines.length > 0 ? lines.join("\n") : "worker/coordinator/discoverer 로그가 없습니다.";
};

const loadPrPackage = async (sessionId, options = {}) => {
  const { quietNotFound = true } = options;
  if (!sessionId) {
    loadPrPackageRequestVersion += 1;
    activePrPackage = null;
    renderPrPackageSummary();
    return null;
  }

  const requestVersion = ++loadPrPackageRequestVersion;
  const res = await fetch(`/api/sessions/${sessionId}/pr-package`);
  const body = await res.json().catch(() => ({}));

  if (!isActiveSession(sessionId) || requestVersion !== loadPrPackageRequestVersion) {
    return activePrPackage;
  }

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

const renderGoalValidationSummary = () => {
  if (!goalValidationSummaryEl) return;

  const goalEvents = allEvents.filter(
    (event) => event.phase === "goal_validation" || event.type === "goal_validation_passed" || event.type === "goal_validation_failed"
  );

  if (goalEvents.length === 0) {
    goalValidationSummaryEl.textContent = "Goal validation 정보가 아직 없습니다.";
    return;
  }

  const latestDecision = [...goalEvents]
    .reverse()
    .find((event) => event.type === "goal_validation_passed" || event.type === "goal_validation_failed");
  const latestArtifact = [...goalEvents]
    .reverse()
    .find((event) => event.type === "artifact_created" && event.role === "validator" && event.phase === "goal_validation");

  const lines = [];
  lines.push(`iteration: ${typeof latestDecision?.iteration === "number" ? latestDecision.iteration : "-"}`);
  lines.push(`artifact: ${latestArtifact?.artifactId ?? "-"}`);
  lines.push(`decision: ${latestDecision?.type ?? "-"}`);
  lines.push(`summary: ${typeof latestDecision?.data?.summary === "string" ? latestDecision.data.summary : "-"}`);

  const missingTargets = Array.isArray(latestDecision?.data?.missingTargets)
    ? latestDecision.data.missingTargets.filter((item) => typeof item === "string" && item.trim())
    : [];
  lines.push("");
  lines.push("missing targets:");
  if (missingTargets.length === 0) {
    lines.push("- (none)");
  } else {
    for (const target of missingTargets) {
      lines.push(`- ${target}`);
    }
  }

  if (latestDecision?.type === "goal_validation_failed") {
    lines.push("");
    lines.push("hint:");
    lines.push("- Task Board 완료는 pre-loop worker 작업 완료를 의미합니다.");
    lines.push("- 최종 성공은 goal_validation -> validation -> review 통과 여부로 결정됩니다.");
  }

  goalValidationSummaryEl.textContent = lines.join("\n");
};

const renderCommandCenter = () => {
  if (!commandCenterEl || !commandCenterMetaEl) return;

  commandCenterEl.replaceChildren();
  if (!activeSessionId || !activeSessionState) {
    commandCenterMetaEl.textContent = "No run selected.";
    commandCenterEl.textContent = "실행 중인 run을 선택하면 핵심 상태를 표시합니다.";
    return;
  }

  commandCenterMetaEl.textContent = `run ${activeSessionId.slice(0, 8)} | status ${activeSessionState.status}`;

  const phaseStatuses = activeSessionState.phaseStatuses ?? {};
  const totalTasks = Array.isArray(activeTasks) ? activeTasks.length : 0;
  const doneTasks = activeTasks.filter((task) => taskToColumn(task) === "done").length;
  const runningTasks = activeTasks.filter((task) => taskToColumn(task) === "running").length;
  const blockedTasks = activeTasks.filter((task) => taskToColumn(task) === "blocked").length;

  const cards = [
    {
      label: "Loop",
      value: `${activeSessionState.currentPhase ?? "-"} | iteration ${activeSessionState.iteration ?? 0}`,
      tone: "neutral"
    },
    {
      label: "Goal Gate",
      value: String(phaseStatuses.goal_validation ?? "pending").toUpperCase(),
      tone: phaseStatuses.goal_validation === "failed" ? "danger" : phaseStatuses.goal_validation === "completed" ? "ok" : "neutral"
    },
    {
      label: "Validation",
      value: String(phaseStatuses.validation ?? "pending").toUpperCase(),
      tone: phaseStatuses.validation === "failed" ? "danger" : phaseStatuses.validation === "completed" ? "ok" : "neutral"
    },
    {
      label: "Review",
      value: String(phaseStatuses.review ?? "pending").toUpperCase(),
      tone: phaseStatuses.review === "failed" ? "danger" : phaseStatuses.review === "completed" ? "ok" : "neutral"
    },
    {
      label: "Tasks",
      value: `total ${totalTasks} | done ${doneTasks} | running ${runningTasks} | blocked ${blockedTasks}`,
      tone: blockedTasks > 0 ? "warn" : "neutral"
    },
    {
      label: "Approvals",
      value: `pending ${Array.isArray(activeApprovals) ? activeApprovals.length : 0}`,
      tone: (activeApprovals?.length ?? 0) > 0 ? "warn" : "ok"
    }
  ];

  for (const cardItem of cards) {
    const card = document.createElement("article");
    card.className = `command-card tone-${cardItem.tone}`;

    const label = document.createElement("div");
    label.className = "command-card-label";
    label.textContent = cardItem.label;

    const value = document.createElement("div");
    value.className = "command-card-value";
    value.textContent = cardItem.value;

    card.append(label, value);
    commandCenterEl.appendChild(card);
  }

  if ((phaseStatuses.goal_validation ?? "pending") === "failed" && totalTasks > 0 && doneTasks === totalTasks) {
    const note = document.createElement("article");
    note.className = "command-card tone-danger command-card-wide";

    const label = document.createElement("div");
    label.className = "command-card-label";
    label.textContent = "Mismatch explained";

    const value = document.createElement("div");
    value.className = "command-card-value";
    value.textContent =
      "Task Board done = 팀 준비 작업 완료. Goal failed = 목표 산출물이 아직 부족해서 supervisor loop가 재시도 중.";

    note.append(label, value);
    commandCenterEl.appendChild(note);
  }
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
  renderValidationGuidance();
  renderGoalValidationSummary();
  renderReviewSummary();
  renderPrPackageSummary();
  renderBudgetStatus();
  renderCommandCenter();
  renderPromptLogs();
  renderWorkerLog();
  renderTaskDecomposition();
  renderParallelMonitor();
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

const loadTeamPanels = async (sessionId) => {
  if (!sessionId) {
    loadTeamPanelsRequestVersion += 1;
    activeTasks = [];
    activeHandoffs = [];
    activeDiscovery = null;
    activeApprovals = [];
    renderTaskBoard();
    renderTaskDecomposition();
    renderParallelMonitor();
    renderHandoffsPanel();
    renderDiscoveryPanel();
    renderApprovalsPanel();
    renderCommandCenter();
    return;
  }

  const requestVersion = ++loadTeamPanelsRequestVersion;
  const [tasksBody, handoffsBody, discoveryBody, approvalsBody] = await Promise.all([
    fetchJson(`/api/sessions/${sessionId}/tasks`),
    fetchJson(`/api/sessions/${sessionId}/handoffs`),
    fetchJson(`/api/sessions/${sessionId}/discovery`),
    fetchJson(`/api/approvals/pending?runId=${encodeURIComponent(sessionId)}`)
  ]);

  if (!isActiveSession(sessionId) || requestVersion !== loadTeamPanelsRequestVersion) {
    return;
  }

  activeTasks = Array.isArray(tasksBody.tasks) ? tasksBody.tasks : [];
  activeHandoffs = Array.isArray(handoffsBody.handoffs) ? handoffsBody.handoffs : [];
  activeDiscovery = discoveryBody.discovery ?? null;
  activeApprovals = Array.isArray(approvalsBody.approvals) ? approvalsBody.approvals : [];

  renderTaskBoard();
  renderTaskDecomposition();
  renderParallelMonitor();
  renderHandoffsPanel();
  renderDiscoveryPanel();
  renderApprovalsPanel();
  renderCommandCenter();
};

const loadChatSession = async (chatSessionId) => {
  const [sessionBody, messagesBody] = await Promise.all([
    fetchJson(`/api/chat/sessions/${chatSessionId}`),
    fetchJson(`/api/chat/sessions/${chatSessionId}/messages`)
  ]);

  activeChatSessionId = chatSessionId;
  activeChatSessionState = sessionBody.chatSession;
  activeChatMessages = Array.isArray(messagesBody.messages) ? messagesBody.messages : [];
  if (chatAutonomousInput && typeof activeChatSessionState?.autonomous === "boolean") {
    chatAutonomousInput.checked = activeChatSessionState.autonomous;
  }
  if (chatApprovalModeInput && typeof activeChatSessionState?.approvalMode === "string") {
    chatApprovalModeInput.value = normalizeApprovalMode(activeChatSessionState.approvalMode);
  }
  renderChatPanel();
};

const connectChatStream = (chatSessionId) => {
  closeChatStream();
  chatStream = new EventSource(`/api/chat/sessions/${chatSessionId}/events`);

  chatStream.onmessage = async () => {
    try {
      await loadChatSession(chatSessionId);
    } catch (error) {
      writeDiagnostics("Chat Stream Error", error instanceof Error ? error.message : String(error));
    }
  };

  chatStream.onerror = () => {
    writeDiagnostics("Chat Stream", "SSE connection dropped.");
  };
};

const ensureChatSession = async (options = {}) => {
  const forceNew = options.forceNew === true;
  if (activeChatSessionId && !forceNew) {
    const desiredWorkspaceRoot = (options.workspaceRoot || chatWorkspaceRootInput?.value.trim() || defaultWorkspaceRoot).trim();
    const desiredAutonomous =
      typeof options.autonomous === "boolean" ? options.autonomous : Boolean(chatAutonomousInput?.checked ?? true);
    const desiredApprovalMode = normalizeApprovalMode(
      typeof options.approvalMode === "string" ? options.approvalMode : chatApprovalModeInput?.value
    );
    const matchesCurrent =
      activeChatSessionState &&
      activeChatSessionState.workspaceRoot === desiredWorkspaceRoot &&
      activeChatSessionState.autonomous === desiredAutonomous &&
      normalizeApprovalMode(activeChatSessionState.approvalMode) === desiredApprovalMode;

    if (matchesCurrent) {
      return activeChatSessionId;
    }
  }

  const candidateMode =
    typeof options.approvalMode === "string"
      ? options.approvalMode
      : chatApprovalModeInput?.value || "manual";
  const approvalMode = normalizeApprovalMode(candidateMode);

  const body = await fetchJson("/api/chat/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceRoot: options.workspaceRoot || chatWorkspaceRootInput?.value.trim() || defaultWorkspaceRoot,
      autonomous:
        typeof options.autonomous === "boolean" ? options.autonomous : Boolean(chatAutonomousInput?.checked ?? true),
      approvalMode,
      maxIterations: Number(maxIterationsInput?.value || 6),
      maxMinutes: Number(maxMinutesInput?.value || 45)
    })
  });

  activeChatSessionId = body.chatSessionId;
  await loadChatSession(activeChatSessionId);
  connectChatStream(activeChatSessionId);
  return activeChatSessionId;
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
  const { refreshPrPackage = true, refreshTeamPanels = true } = options;
  const requestVersion = ++loadStatusRequestVersion;
  const data = await fetchJson(`/api/sessions/${sessionId}`);
  if (!isActiveSession(sessionId) || requestVersion !== loadStatusRequestVersion) {
    return data.session;
  }
  activeSessionState = data.session;
  statusEl.textContent = toPrettyJson(data.session);
  renderPhaseTracker(data.session);
  renderBudgetStatus();
  renderCommandCenter();
  renderValidationGuidance();
  if (refreshPrPackage) {
    try {
      await loadPrPackage(sessionId, { quietNotFound: true });
    } catch (error) {
      writeDiagnostics("PR Package Error", error instanceof Error ? error.message : String(error));
    }
  }
  if (refreshTeamPanels) {
    try {
      await loadTeamPanels(sessionId);
    } catch (error) {
      writeDiagnostics("Team Panel Error", error instanceof Error ? error.message : String(error));
    }
  }
  return data.session;
};

const connectEventStream = (sessionId) => {
  closeEventStream();

  stream = new EventSource(`/api/sessions/${sessionId}/events`);
  stream.onmessage = async (msg) => {
    if (!isActiveSession(sessionId)) return;
    const eventData = JSON.parse(msg.data);
    appendEvent(eventData);
    const session = await loadStatus(sessionId);
    if (!isActiveSession(sessionId)) return;
    if (isTerminalSessionStatus(session.status)) {
      closeEventStream();
    }
    await loadSessions();
  };

  stream.onerror = async () => {
    if (!isActiveSession(sessionId)) return;
    try {
      const session = await loadStatus(sessionId);
      if (!isActiveSession(sessionId)) return;
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
  const requestVersion = ++openSessionRequestVersion;
  activeSessionId = sessionId;
  activeSessionState = null;
  activePrPackage = null;
  activeTasks = [];
  activeHandoffs = [];
  activeDiscovery = null;
  activeApprovals = [];
  allEvents.length = 0;
  seenEventKeys.clear();
  statusEl.textContent = "Loading session...";
  renderPhaseTracker(null);
  renderBudgetStatus();
  renderGoalValidationSummary();
  renderCommandCenter();
  renderEvents();
  renderTaskBoard();
  renderTaskDecomposition();
  renderParallelMonitor();
  renderHandoffsPanel();
  renderDiscoveryPanel();
  renderApprovalsPanel();

  const detail = await fetchJson(`/api/sessions/${sessionId}`);
  if (!isActiveSession(sessionId) || requestVersion !== openSessionRequestVersion) {
    return;
  }
  activeSessionState = detail.session;
  statusEl.textContent = toPrettyJson(detail.session);
  renderPhaseTracker(detail.session);
  renderBudgetStatus();
  await loadPrPackage(sessionId, { quietNotFound: true });
  await loadTeamPanels(sessionId);
  if (!isActiveSession(sessionId) || requestVersion !== openSessionRequestVersion) {
    return;
  }
  for (const event of detail.events) {
    appendEvent(event);
  }

  if (!isActiveSession(sessionId) || requestVersion !== openSessionRequestVersion) {
    return;
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

refreshOverviewBtn.addEventListener("click", refreshOverview);
pingHealthBtn.addEventListener("click", pingHealth);
pingLlmBtn.addEventListener("click", pingLlm);
runCommandBtn.addEventListener("click", runCommand);
if (createChatSessionBtn) {
  createChatSessionBtn.addEventListener("click", async () => {
    setBusy(createChatSessionBtn, true, "Creating...", "Create Chat Session");
    try {
      const chatSessionId = await ensureChatSession({
        workspaceRoot: chatWorkspaceRootInput?.value.trim() || defaultWorkspaceRoot,
        autonomous: chatAutonomousInput?.checked ?? true,
        approvalMode: normalizeApprovalMode(chatApprovalModeInput?.value),
        forceNew: true
      });
      writeDiagnostics("Chat Session Ready", {
        chatSessionId,
        approvalMode: normalizeApprovalMode(chatApprovalModeInput?.value)
      });
    } catch (error) {
      writeDiagnostics("Chat Session Error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(createChatSessionBtn, false, "Creating...", "Create Chat Session");
    }
  });
}

if (refreshChatSessionBtn) {
  refreshChatSessionBtn.addEventListener("click", async () => {
    if (!activeChatSessionId) {
      writeDiagnostics("Chat Session", "먼저 chat session을 생성하세요.");
      return;
    }
    setBusy(refreshChatSessionBtn, true, "Reloading...", "Reload Chat");
    try {
      await loadChatSession(activeChatSessionId);
      writeDiagnostics("Chat Session", { chatSessionId: activeChatSessionId });
    } catch (error) {
      writeDiagnostics("Chat Session Error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(refreshChatSessionBtn, false, "Reloading...", "Reload Chat");
    }
  });
}

if (chatMessageForm) {
  chatMessageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sendChatMessageBtn) return;
    setBusy(sendChatMessageBtn, true, "Sending...", "Send & Run");

    try {
      const content = chatMessageInput?.value.trim() ?? "";
      if (!content) {
        throw new Error("지시어를 입력하세요.");
      }

      const chatSessionId = await ensureChatSession({
        workspaceRoot: chatWorkspaceRootInput?.value.trim() || defaultWorkspaceRoot,
        autonomous: chatAutonomousInput?.checked ?? true,
        approvalMode: normalizeApprovalMode(chatApprovalModeInput?.value)
      });

      const body = await fetchJson(`/api/chat/sessions/${chatSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });

      chatMessageInput.value = "";
      await loadChatSession(chatSessionId);
      connectChatStream(chatSessionId);
      await openSession(body.runSessionId);
      await loadSessions();

      writeDiagnostics("Chat Run Started", {
        chatSessionId,
        runSessionId: body.runSessionId,
        content,
        approvalMode: normalizeApprovalMode(chatApprovalModeInput?.value)
      });
    } catch (error) {
      writeDiagnostics("Chat Run Error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(sendChatMessageBtn, false, "Sending...", "Send & Run");
    }
  });
}
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
if (uiModeTeamBtn) {
  uiModeTeamBtn.addEventListener("click", () => {
    applyUiMode("team");
  });
}
if (uiModeDebugBtn) {
  uiModeDebugBtn.addEventListener("click", () => {
    applyUiMode("debug");
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

applyUiMode(getInitialUiMode());
renderEvents();
renderPhaseTracker(null);
renderGoalValidationSummary();
renderPrPackageSummary();
renderSupervisorMonitor();
renderChatPanel();
renderCommandCenter();
renderTaskBoard();
renderTaskDecomposition();
renderParallelMonitor();
renderHandoffsPanel();
renderDiscoveryPanel();
renderApprovalsPanel();
renderWorkerLog();
initSessionPresets();

refreshOverview().catch((error) => {
  writeDiagnostics("Overview Error", error instanceof Error ? error.message : String(error));
});

loadSessions().catch((error) => {
  writeDiagnostics("Session List Error", error instanceof Error ? error.message : String(error));
});
