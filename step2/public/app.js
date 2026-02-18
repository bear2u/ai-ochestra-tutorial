const form = document.getElementById("session-form");
const statusEl = document.getElementById("status");
const phaseTrackerEl = document.getElementById("phase-tracker");
const phaseMetaEl = document.getElementById("phase-meta");
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

const toPrettyJson = (value) => JSON.stringify(value, null, 2);
const phaseOrder = ["planning", "architecture", "design", "implementation", "validation", "review", "packaging"];
const loopPhases = new Set(["implementation", "validation"]);

const sessionPresets = [
  {
    id: "phase-planning-smoke",
    label: "1) Planning 스모크 (성공)",
    stage: "planning",
    description: "선행 phase 이벤트(planning -> architecture -> design) 시작/완료를 빠르게 확인합니다.",
    task: "planning phase 이벤트 스모크 테스트",
    filePaths: ["playground/planning-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "phase-architecture-smoke",
    label: "2) Architecture 스모크 (성공)",
    stage: "architecture",
    description: "architecture 중심 태스크로 phase 메타데이터를 확인합니다.",
    task: "architecture phase 이벤트 스모크 테스트",
    filePaths: ["playground/architecture-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "phase-design-smoke",
    label: "3) Design 스모크 (성공)",
    stage: "design",
    description: "design 단계 포함 이벤트 흐름을 확인합니다.",
    task: "design phase 이벤트 스모크 테스트",
    filePaths: ["playground/design-smoke.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "phase-implementation-check",
    label: "4) Implementation 변경 반영 (성공)",
    stage: "implementation",
    description: "implementation에서 file change 적용 이벤트를 확인합니다.",
    task: "implementation phase에서 파일 변경 반영 확인",
    filePaths: ["playground/implementation-smoke.txt"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "phase-validation-pass",
    label: "5) Validation 통과 이벤트",
    stage: "validation",
    description: "validation phase의 tests_passed 이벤트를 확인합니다.",
    task: "validation tests_passed 이벤트 확인",
    filePaths: ["playground/validation-pass.txt"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "phase-validation-fail",
    label: "6) Validation 실패 재시도 (3회)",
    stage: "validation",
    description: "implementation/validation 반복과 iteration 증가를 확인합니다.",
    task: "validation tests_failed와 iteration 증가 확인",
    filePaths: ["playground/validation-fail.txt"],
    testCommand: "node -e \"console.error('fail'); process.exit(1)\"",
    maxAttempts: 3
  },
  {
    id: "phase-review-packaging-success",
    label: "7) Review/Packaging 완료 확인",
    stage: "review-packaging",
    description: "성공 후 review -> packaging -> session_finished 전이를 검증합니다.",
    task: "review 및 packaging phase 완료 확인",
    filePaths: ["playground/release-note.md"],
    testCommand: "node -e \"console.log('ok'); process.exit(0)\"",
    maxAttempts: 3
  },
  {
    id: "loop-fail-fast",
    label: "8) 실패 즉시 종료 (1회)",
    stage: "loop",
    description: "maxAttempts=1에서 바로 failed 전이를 확인합니다.",
    task: "maxAttempts 1에서 실패 전이 확인",
    filePaths: ["playground/fail-fast.txt"],
    testCommand: "node -e \"console.error('fail-fast'); process.exit(1)\"",
    maxAttempts: 1
  },
  {
    id: "loop-fail-with-skipped",
    label: "9) 실패 후 skipped phase 확인",
    stage: "loop",
    description: "실패 종료 시 review/packaging의 phase_skipped 이벤트를 확인합니다.",
    task: "failed 종료 후 review/packaging phase_skipped 확인",
    filePaths: ["session-smoke.txt"],
    testCommand: "node -e \"console.error('fail'); process.exit(1)\"",
    maxAttempts: 3
  },
  {
    id: "real-project-regression",
    label: "10) 실제 프로젝트 테스트(pnpm test)",
    stage: "real",
    description: "실제 파일과 pnpm test로 end-to-end 회귀 검증을 수행합니다.",
    task: "src/utils/json.ts 안정화 및 테스트 통과",
    filePaths: ["src/utils/json.ts", "tests/json.test.ts"],
    testCommand: "pnpm test",
    maxAttempts: 2
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
  row.className = `event-item ${roleClass}`;

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

  if (typeof event.data?.summary === "string" && event.data.summary.trim()) {
    const summary = document.createElement("div");
    summary.className = "event-summary";
    summary.textContent = event.data.summary;
    row.appendChild(summary);
  }

  return row;
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
};

const connectEventStream = (sessionId) => {
  if (stream) {
    stream.close();
  }

  stream = new EventSource(`/api/sessions/${sessionId}/events`);
  stream.onmessage = async (msg) => {
    const eventData = JSON.parse(msg.data);
    appendEvent(eventData);
    await loadStatus(sessionId);
    await loadSessions();
  };

  stream.onerror = () => {
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
    openBtn.textContent = activeSessionId === session.id ? "Watching" : "Open";
    openBtn.disabled = activeSessionId === session.id;
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
