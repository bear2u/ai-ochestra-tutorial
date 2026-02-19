const form = document.getElementById("session-form");
const statusEl = document.getElementById("status");
const phaseTrackerEl = document.getElementById("phase-tracker");
const phaseMetaEl = document.getElementById("phase-meta");
const validationSummaryEl = document.getElementById("validation-summary");
const reviewSummaryEl = document.getElementById("review-summary");
const budgetStatusEl = document.getElementById("budget-status");
const promptLogsEl = document.getElementById("prompt-logs");
const eventsEl = document.getElementById("events");
const sessionsListEl = document.getElementById("sessions-list");
const diagnosticsEl = document.getElementById("diagnostics-output");

const refreshOverviewBtn = document.getElementById("refresh-overview");
const pingHealthBtn = document.getElementById("ping-health");
const pingLlmBtn = document.getElementById("ping-llm");
const runCommandBtn = document.getElementById("run-command");
const refreshSessionsBtn = document.getElementById("refresh-sessions");

const pingPromptInput = document.getElementById("ping-prompt");
const commandInput = document.getElementById("tool-command");
const presetSelect = document.getElementById("session-preset");
const presetHelp = document.getElementById("session-preset-help");
const presetPreviewEl = document.getElementById("session-preset-preview");
const taskInput = document.getElementById("task");
const filesInput = document.getElementById("files");
const testInput = document.getElementById("test");
const validationCommandsInput = document.getElementById("validationCommands");
const maxIterationsInput = document.getElementById("maxIterations");
const maxMinutesInput = document.getElementById("maxMinutes");
const roleFilterInputs = [...document.querySelectorAll("input[data-role-filter]")];

let stream;
let activeSessionId = "";
let activeSessionState = null;
let activePresetConfig = null;
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
    id: "step5-e2e-success",
    label: "1) Step5 E2E 성공",
    stage: "step5-e2e",
    description: "planning부터 review 승인, packaging까지 전체 성공 경로를 확인합니다.",
    task: "[force_review_approve] step5 pre-loop + loop + review + packaging success",
    filePaths: ["playground/planning-smoke.md", "playground/architecture-smoke.md", "playground/design-smoke.md"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 4,
    maxMinutes: 45,
    expected: "validation pass + review approved -> packaging -> session success",
    checkpoints: ["review_approved", "artifact_created(phase=review)", "session_finished(success)"]
  },
  {
    id: "step5-validation-fail-twice-then-pass",
    label: "2) 2회 실패 후 3회 성공",
    stage: "step5-validation-retry",
    description: "validation을 2번 실패시키고 3번째 iteration에 통과하는 회복 루프를 검증합니다.",
    task: "[force_review_approve] step5 validation fails twice then succeeds",
    filePaths: ["playground/validation-fail.txt", "playground/validation-pass.txt"],
    testCommand: "",
    validationCommands: [
      "node -e \"const fs=require('fs');const p='.step5_retry_twice';const n=fs.existsSync(p)?(parseInt(fs.readFileSync(p,'utf8'),10)||0):0;if(n>=2){fs.unlinkSync(p);console.log('pass on third iteration');process.exit(0)}fs.writeFileSync(p,String(n+1));console.error('forced fail iteration '+(n+1));process.exit(1)\""
    ],
    maxIterations: 6,
    maxMinutes: 45,
    expected: "iteration 1/2 tests_failed, iteration 3 tests_passed 후 review_approved",
    checkpoints: ["tests_failed", "tests_passed", "review_approved"]
  },
  {
    id: "step5-review-blocking-budget-exhausted",
    label: "3) Iteration 예산 소진",
    stage: "step5-review-blocking",
    description: "review를 강제로 blocking 처리해서 재작업 루프 후 예산 소진 종료를 확인합니다.",
    task: "[force_review_block] step5 review blocking until budget exhausted",
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "",
    validationCommands: ["node -e \"console.log('validation ok'); process.exit(0)\""],
    maxIterations: 3,
    maxMinutes: 45,
    expected: "review blocking 반복 후 budget_exhausted(iterations)로 종료",
    checkpoints: ["review_blocking_detected", "budget_exhausted", "session_finished(failed_budget_exhausted)"]
  },
  {
    id: "step5-validation-runtime-failure",
    label: "4) Validation 런타임 실패",
    stage: "step5-validation-runtime",
    description: "validation command 런타임 오류 분류와 재시도/종료 경로를 확인합니다.",
    task: "[force_review_approve] step5 validation runtime failure classification",
    filePaths: ["playground/fail-fast.txt"],
    testCommand: "",
    validationCommands: ["node -e \"throw new Error('forced runtime failure in validation')\""],
    maxIterations: 2,
    maxMinutes: 10,
    expected: "tests_failed(classification=runtime) 누적 후 failed_budget_exhausted",
    checkpoints: ["tests_failed", "validation_failed_classification", "session_finished(failed_budget_exhausted)"]
  },
  {
    id: "step5-legacy-max-attempts-compat",
    label: "5) Legacy maxAttempts 호환",
    stage: "step5-legacy-compat",
    description: "기존 maxAttempts 입력 기반으로도 Step5 session이 정상 동작하는지 확인합니다.",
    task: "[force_review_approve] step5 legacy maxAttempts compatibility",
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    validationCommands: [],
    maxIterations: 3,
    maxMinutes: 45,
    useLegacyMaxAttempts: true,
    expected: "legacy 입력과 동일하게 validation/review/packaging 완료",
    checkpoints: ["maxAttempts 매핑", "review_approved", "session_finished(success)"]
  }
];

const writeDiagnostics = (title, payload) => {
  const header = `[${now()}] ${title}`;
  const body = typeof payload === "string" ? payload : toPrettyJson(payload);
  diagnosticsEl.textContent = `${header}\n${body}`;
};

const defaultPresetHelp = "선택 시 Task, File paths, Test command, Validation commands, Max iterations, Max minutes가 자동으로 채워집니다.";
const defaultPresetPreview = "시나리오를 선택하면 Step5 체크포인트를 미리 보여줍니다.";

const parseValidationCommands = (value) =>
  value
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

const applySessionPreset = (presetId) => {
  const preset = sessionPresets.find((item) => item.id === presetId);
  if (!preset) {
    activePresetConfig = null;
    if (presetHelp) presetHelp.textContent = defaultPresetHelp;
    if (presetPreviewEl) presetPreviewEl.textContent = defaultPresetPreview;
    return;
  }
  activePresetConfig = preset;

  taskInput.value = preset.task;
  filesInput.value = preset.filePaths.join(",");
  testInput.value = preset.testCommand;
  validationCommandsInput.value = (preset.validationCommands ?? []).join("\n");
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
    task: preset.task,
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
  renderValidationSummary();
  renderReviewSummary();
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

const loadStatus = async (sessionId) => {
  const data = await fetchJson(`/api/sessions/${sessionId}`);
  activeSessionState = data.session;
  statusEl.textContent = toPrettyJson(data.session);
  renderPhaseTracker(data.session);
  renderBudgetStatus();
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
  allEvents.length = 0;
  seenEventKeys.clear();
  renderEvents();

  const detail = await fetchJson(`/api/sessions/${sessionId}`);
  activeSessionState = detail.session;
  statusEl.textContent = toPrettyJson(detail.session);
  renderPhaseTracker(detail.session);
  renderBudgetStatus();
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

    const task = document.createElement("div");
    task.className = "session-meta";
    task.textContent = session.input.task;

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
    card.appendChild(task);
    card.appendChild(badge);
    card.appendChild(openBtn);
    sessionsListEl.appendChild(card);
  }
};

const refreshOverview = async () => {
  setBusy(refreshOverviewBtn, true, "Loading...", "Refresh");
  try {
    const [health, overview] = await Promise.all([fetchJson("/api/health"), fetchJson("/api/tools/overview")]);
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
    if (!trimmedTestCommand && validationCommands.length === 0) {
      throw new Error("testCommand 또는 validationCommands 중 하나는 필수입니다.");
    }

    const payload = {
      task: taskInput.value,
      filePaths: filesInput
        .value.split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      testCommand: trimmedTestCommand || undefined,
      validationCommands: validationCommands.length > 0 ? validationCommands : undefined,
      maxMinutes: Number.parseInt(maxMinutesInput.value || "45", 10)
    };
    const maxIterations = Number.parseInt(maxIterationsInput.value || "6", 10);
    if (activePresetConfig?.useLegacyMaxAttempts) {
      payload.maxAttempts = maxIterations;
    } else {
      payload.maxIterations = maxIterations;
    }

    const body = await fetchJson("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await openSession(body.sessionId);
    await loadSessions();
    writeDiagnostics("Session Started", { sessionId: body.sessionId });
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
initSessionPresets();

refreshOverview().catch((error) => {
  writeDiagnostics("Overview Error", error instanceof Error ? error.message : String(error));
});

loadSessions().catch((error) => {
  writeDiagnostics("Session List Error", error instanceof Error ? error.message : String(error));
});
