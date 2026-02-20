import { randomUUID } from "node:crypto";
import { TaskCard, TaskGraphArtifact } from "../types";

export interface DecomposeInput {
  runId: string;
  topic: string;
  selectedFiles: string[];
  maxParallelWorkers: number;
}

interface BootstrapBlueprint {
  title: string;
  objective: string;
  targetFiles: string[];
  acceptanceCriteria: string[];
  commands: string[];
  bootstrapOnly: boolean;
}

const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
};

const includesAny = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));
const dedupeStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

const hasPostSetupFeatureIntent = (topic: string): boolean =>
  includesAny(topic, [
    /\btodo\b/i,
    /\bkanban\b/i,
    /\bboard\b/i,
    /\bfeature\b/i,
    /\bapi\b/i,
    /\bcomponent\b/i,
    /기능/,
    /컴포넌트/,
    /페이지/,
    /화면/,
    /구현/,
    /개발/,
    /칸반/,
    /보드/
  ]);

const createBootstrapBlueprint = (topic: string): BootstrapBlueprint | undefined => {
  const normalized = topic.toLowerCase();
  const wantsExample = /\bexample\b/.test(normalized);
  const wantsCreate = includesAny(topic, [/(install|setup|create|make|만들|생성|설치|구성|세팅|셋업)/i]);
  const wantsNext = includesAny(normalized, [/\bnextjs\b/i, /\bnext\.js\b/i, /\bnext\s*16\b/i, /\bnextjs16\b/i]);
  const wantsShadcn = /shadcn/i.test(normalized);
  const wantsReact = includesAny(normalized, [/\breact\b/i, /리액트/i]);

  if (wantsExample && wantsCreate && wantsNext && wantsShadcn) {
    return {
      title: "Bootstrap Example Next.js + shadcn",
      objective: "Create example workspace and install Next.js + shadcn base setup.",
      targetFiles: ["example/package.json", "example/src/app/page.tsx", "example/components.json"],
      acceptanceCriteria: [
        "`example` directory exists in workspace root",
        "Next.js app scaffold is created under `example`",
        "shadcn initialization command runs successfully"
      ],
      commands: [
        "pnpm create next-app@latest example --ts --eslint --tailwind --app --src-dir --use-pnpm --yes",
        "pnpm dlx shadcn@latest init --yes --defaults --cwd example"
      ],
      bootstrapOnly: !hasPostSetupFeatureIntent(topic)
    };
  }

  if (wantsExample && wantsCreate && wantsReact) {
    return {
      title: "Bootstrap Example React (Vite)",
      objective: "Create example workspace and scaffold React TypeScript app.",
      targetFiles: ["example/package.json", "example/src/main.tsx", "example/src/App.tsx"],
      acceptanceCriteria: [
        "`example` directory exists in workspace root",
        "React scaffold is created under `example`",
        "`example/package.json` contains react dependency"
      ],
      commands: ["pnpm create vite@latest example --template react-ts"],
      bootstrapOnly: !hasPostSetupFeatureIntent(topic)
    };
  }

  return undefined;
};

export class TaskDecomposerAgent {
  decompose(input: DecomposeInput): TaskGraphArtifact {
    const maxWorkers = Math.max(1, Math.min(input.maxParallelWorkers, 5));
    const now = new Date().toISOString();

    const bootstrapBlueprint = createBootstrapBlueprint(input.topic);
    const selectedExampleFiles = input.selectedFiles.filter((path) => path.startsWith("example/"));
    const sourceFiles = bootstrapBlueprint
      ? dedupeStrings([
          ...bootstrapBlueprint.targetFiles,
          ...(bootstrapBlueprint.bootstrapOnly ? [] : selectedExampleFiles)
        ])
      : input.selectedFiles;
    const sourceGroups = chunk(sourceFiles, Math.max(1, Math.ceil(sourceFiles.length / maxWorkers))).slice(0, maxWorkers);
    const bootstrapTask: TaskCard | undefined = bootstrapBlueprint
      ? {
          id: randomUUID(),
          runId: input.runId,
          title: bootstrapBlueprint.title,
          objective: bootstrapBlueprint.objective,
          phase: "implementation",
          status: "queued",
          assignee: "worker",
          dependencies: [],
          targetFiles: [...bootstrapBlueprint.targetFiles],
          acceptanceCriteria: [...bootstrapBlueprint.acceptanceCriteria],
          commands: [...bootstrapBlueprint.commands],
          handoffRequired: true,
          retries: 0,
          createdAt: now,
          updatedAt: now
        }
      : undefined;

    const workerDependencies = bootstrapTask ? [bootstrapTask.id] : [];

    const workerTasks: TaskCard[] = (bootstrapBlueprint?.bootstrapOnly ? [] : sourceGroups).map((files, index) => ({
      id: randomUUID(),
      runId: input.runId,
      title: `Worker Task ${index + 1}`,
      objective: input.topic,
      phase: "implementation",
      status: "queued",
      assignee: "worker",
      dependencies: [...workerDependencies],
      targetFiles: [...files],
      acceptanceCriteria: ["Apply minimal safe patch", "Keep file syntax valid"],
      commands: [],
      handoffRequired: true,
      retries: 0,
      createdAt: now,
      updatedAt: now
    }));

    const mergeTask: TaskCard = {
      id: randomUUID(),
      runId: input.runId,
      title: "Merge & Handoff Review",
      objective: "Collect worker handoffs and finalize implementation set.",
      phase: "review",
      status: "queued",
      assignee: "coordinator",
      dependencies: [
        ...(bootstrapTask ? [bootstrapTask.id] : []),
        ...workerTasks.map((task) => task.id)
      ],
      targetFiles: [],
      acceptanceCriteria: ["All worker tasks are completed", "Handoffs are accepted"],
      commands: [],
      handoffRequired: false,
      retries: 0,
      createdAt: now,
      updatedAt: now
    };

    const tasks = [...(bootstrapTask ? [bootstrapTask] : []), ...workerTasks, mergeTask];
    const edges = [
      ...workerTasks.map((task) => ({ from: task.id, to: mergeTask.id })),
      ...(bootstrapTask
        ? workerTasks.length > 0
          ? workerTasks.map((task) => ({ from: bootstrapTask.id, to: task.id }))
          : [{ from: bootstrapTask.id, to: mergeTask.id }]
        : [])
    ];

    return {
      id: randomUUID(),
      runId: input.runId,
      tasks,
      edges,
      createdAt: now
    };
  }
}
