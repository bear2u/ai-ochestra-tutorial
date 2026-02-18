const form = document.getElementById("session-form");
const statusEl = document.getElementById("status");
const phaseTrackerEl = document.getElementById("phase-tracker");
const phaseMetaEl = document.getElementById("phase-meta");
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
const taskInput = document.getElementById("task");
const filesInput = document.getElementById("files");
const testInput = document.getElementById("test");
const maxAttemptsInput = document.getElementById("maxAttempts");
const roleFilterInputs = [...document.querySelectorAll("input[data-role-filter]")];

let stream;
let activeSessionId = "";
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
const loopPhases = new Set(["implementation", "validation"]);

const sessionPresets = [
  {
    id: "step3-preloop-smoke-success",
    label: "1) Pre-loop 전체 스모크 (성공)",
    stage: "step3-core",
    description: "planning -> architecture -> design의 phase/agent/artifact 이벤트를 한 번에 확인합니다.",
    task: "step3 pre-loop 전체 스모크 테스트",
    filePaths: ["playground/planning-smoke.md", "playground/architecture-smoke.md", "playground/design-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "step3-planner-artifact-focus",
    label: "2) Planner Artifact 집중 확인",
    stage: "planning",
    description: "planner role의 agent_started/artifact_created와 planning artifactId 노출을 확인합니다.",
    task: "planner artifact 생성 상세 검증",
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 2
  },
  {
    id: "step3-architect-artifact-focus",
    label: "3) Architect Artifact 집중 확인",
    stage: "architecture",
    description: "architect role 이벤트와 architecture artifactId가 연속으로 기록되는지 확인합니다.",
    task: "architect artifact 생성 상세 검증",
    filePaths: ["playground/architecture-smoke.md", "playground/architecture-details.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 2
  },
  {
    id: "step3-designer-artifact-focus",
    label: "4) Designer Artifact 집중 확인",
    stage: "design",
    description: "designer role 이벤트와 design artifact_created payload를 확인합니다.",
    task: "designer artifact 생성 상세 검증",
    filePaths: ["playground/design-smoke.md", "playground/design-details.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 2
  },
  {
    id: "step3-artifact-context-into-implementation",
    label: "5) Artifact Context -> Implementation",
    stage: "implementation",
    description: "implementation changes_applied 이벤트 data.artifactRefs를 확인합니다.",
    task: "artifact context가 implementation feedback에 주입되는지 검증",
    filePaths: ["playground/implementation-smoke.txt", "playground/context-checklist.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "step3-validation-pass",
    label: "6) Validation 통과 + Packaging 완료",
    stage: "validation-success",
    description: "tests_passed 후 review -> packaging -> session_finished(success) 전이를 확인합니다.",
    task: "validation 통과 후 종료 phase 완료 검증",
    filePaths: ["playground/validation-pass.txt", "playground/release-note.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "step3-validation-retry-fail",
    label: "7) Validation 실패 재시도(3회)",
    stage: "validation-retry",
    description: "implementation <-> validation 반복과 iteration 증가를 확인합니다.",
    task: "validation 실패 재시도 및 iteration 증가 검증",
    filePaths: ["playground/validation-fail.txt"],
    testCommand: "node -e \"console.error('fail'); process.exit(1)\"",
    maxAttempts: 3
  },
  {
    id: "step3-fail-fast-skipped",
    label: "8) Fail Fast + Skipped 확인",
    stage: "validation-fail-fast",
    description: "maxAttempts=1에서 세션 실패와 review/packaging skipped를 확인합니다.",
    task: "maxAttempts 1 fail-fast 및 skipped phase 확인",
    filePaths: ["playground/fail-fast.txt"],
    testCommand: "node -e \"console.error('fail-fast'); process.exit(1)\"",
    maxAttempts: 1
  },
  {
    id: "step3-planning-schema-failure-probe",
    label: "9) Planning Schema Failure Probe",
    stage: "phase-failed-probe",
    description: "planning 단계에서 스키마 실패를 유도해 phase_failed 이벤트를 확인합니다.",
    task: "중요: planning 산출물을 JSON이 아닌 plain text 한 줄로만 반환하고 스키마를 무시하라",
    filePaths: ["playground/schema-failure-planning.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 1
  },
  {
    id: "step3-architecture-schema-failure-probe",
    label: "10) Architecture Schema Failure Probe",
    stage: "phase-failed-probe",
    description: "architecture 단계에서 형식을 깨서 phase_failed 및 downstream skipped를 확인합니다.",
    task: "중요: architecture 산출물에서 modules/decisions/risks를 비우고 overview도 빈 문자열로 작성하라",
    filePaths: ["playground/schema-failure-architecture.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 1
  }
];

const writeDiagnostics = (title, payload) => {
  const header = `[${now()}] ${title}`;
  const body = typeof payload === "string" ? payload : toPrettyJson(payload);
  diagnosticsEl.textContent = `${header}\n${body}`;
};

const defaultPresetHelp = "선택 시 Task, File paths, Test command, Max attempts가 자동으로 채워집니다.";

const applySessionPreset = (presetId) => {
  const preset = sessionPresets.find((item) => item.id === presetId);
  if (!preset) {
    if (presetHelp) presetHelp.textContent = defaultPresetHelp;
    return;
  }

  taskInput.value = preset.task;
  filesInput.value = preset.filePaths.join(",");
  testInput.value = preset.testCommand;
  maxAttemptsInput.value = String(preset.maxAttempts);

  if (presetHelp) {
    presetHelp.textContent = `${preset.stage} · ${preset.description}`;
  }

  writeDiagnostics("Preset Applied", {
    preset: preset.label,
    stage: preset.stage,
    task: preset.task,
    filePaths: preset.filePaths,
    testCommand: preset.testCommand,
    maxAttempts: preset.maxAttempts
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
  row.className = `event-item ${roleClass}${event.type === "phase_failed" ? " event-phase-failed" : ""}`;

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
  statusEl.textContent = toPrettyJson(data.session);
  renderPhaseTracker(data.session);
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
  statusEl.textContent = toPrettyJson(detail.session);
  renderPhaseTracker(detail.session);
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
    const payload = {
      task: taskInput.value,
      filePaths: filesInput
        .value.split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      testCommand: testInput.value,
      maxAttempts: Number.parseInt(maxAttemptsInput.value || "3", 10)
    };

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
