import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { GoalValidationArtifact, GoalValidationCheck } from "../types";

export interface GoalValidationInput {
  sessionId: string;
  iteration: number;
  topic: string;
  workspaceRoot?: string;
  changedFiles: string[];
  filePaths: string[];
}

const includesAny = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));
const dedupeStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

const isWithinOrEqual = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const extractRequestedDirectories = (topic: string): string[] => {
  const requested = new Set<string>();

  for (const match of topic.matchAll(/\b([a-zA-Z0-9._-]+)\s*(?:folder|directory)\b/gi)) {
    requested.add(match[1]);
  }
  for (const match of topic.matchAll(/\b(?:folder|directory)\s+([a-zA-Z0-9._-]+)\b/gi)) {
    requested.add(match[1]);
  }
  for (const match of topic.matchAll(/([a-zA-Z0-9._-]+)\s*폴더/g)) {
    requested.add(match[1]);
  }
  for (const match of topic.matchAll(/폴더\s*([a-zA-Z0-9._-]+)/g)) {
    requested.add(match[1]);
  }

  return [...requested].map((name) => name.replace(/^\.?\//, "").trim()).filter(Boolean);
};

const hasNextDependency = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).some((key) => key.trim().toLowerCase() === "next");
};

const hasReactDependency = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).some((key) => key.trim().toLowerCase() === "react");
};

const hasShadcnSignals = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  const packageNames = Object.keys(object).map((name) => name.trim().toLowerCase());
  return packageNames.some((name) =>
    [
      "@radix-ui/react-slot",
      "@radix-ui/react-label",
      "class-variance-authority",
      "tailwindcss-animate",
      "lucide-react"
    ].includes(name)
  );
};

export class GoalValidatorAgent {
  constructor(private readonly root = config.workspaceRoot) {}

  resolveWorkspaceRoot(workspaceRoot?: string): string {
    const input = workspaceRoot?.trim();
    if (!input) {
      return this.root;
    }
    const absolute = path.resolve(this.root, input);
    if (!isWithinOrEqual(absolute, this.root)) {
      throw new Error(`Unsafe workspaceRoot rejected in goal validator: ${workspaceRoot}`);
    }
    return absolute;
  }

  private async statPath(absolutePath: string): Promise<Stats | undefined> {
    try {
      return await fs.stat(absolutePath);
    } catch {
      return undefined;
    }
  }

  private async readJson(absolutePath: string): Promise<Record<string, unknown> | undefined> {
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return undefined;
      return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  async validate(input: GoalValidationInput): Promise<Omit<GoalValidationArtifact, "id" | "sessionId" | "phase" | "createdAt">> {
    const workspaceRoot = this.resolveWorkspaceRoot(input.workspaceRoot);
    const checks: GoalValidationCheck[] = [];
    const missingTargets: string[] = [];
    const suggestions: string[] = [];

    const topic = input.topic.trim();
    const normalizedTopic = topic.toLowerCase();
    const requestedDirectories = extractRequestedDirectories(topic);

    for (const directory of requestedDirectories) {
      const absoluteDir = path.resolve(workspaceRoot, directory);
      const stat = await this.statPath(absoluteDir);
      const passed = Boolean(stat?.isDirectory());
      checks.push({
        id: `dir:${directory}`,
        label: `Directory exists: ${directory}`,
        passed,
        detail: passed ? "Directory is present." : "Requested directory was not found.",
        expected: directory,
        actual: passed ? "exists" : "missing"
      });
      if (!passed) {
        missingTargets.push(directory);
      }
    }

    const wantsNext = includesAny(normalizedTopic, [/\bnextjs\b/i, /\bnext\.js\b/i, /\bnext\s*16\b/i, /\bnextjs16\b/i]);
    const wantsReact = includesAny(normalizedTopic, [/\breact\b/i, /리액트/i]);

    if (wantsReact && !wantsNext) {
      const packageCandidates = requestedDirectories.length > 0 ? requestedDirectories.map((directory) => `${directory}/package.json`) : ["package.json"];
      let matchedPackage = "";

      for (const candidate of packageCandidates) {
        const pkgJson = await this.readJson(path.resolve(workspaceRoot, candidate));
        if (!pkgJson) continue;
        if (hasReactDependency(pkgJson.dependencies) || hasReactDependency(pkgJson.devDependencies)) {
          matchedPackage = candidate;
          break;
        }
      }

      const passed = matchedPackage.length > 0;
      checks.push({
        id: "react-dependency",
        label: "React dependency is installed",
        passed,
        detail: passed ? `Found in ${matchedPackage}.` : "Could not find `react` dependency in target package.json.",
        expected: "package.json dependencies.react",
        actual: matchedPackage || "not-found"
      });
      if (!passed) {
        missingTargets.push(packageCandidates[0] ?? "package.json");
        suggestions.push("Run `pnpm create vite@latest <dir> --template react-ts`.");
      }
    }

    if (wantsNext) {
      const packageCandidates = requestedDirectories.length > 0 ? requestedDirectories.map((directory) => `${directory}/package.json`) : ["package.json"];
      let matchedPackage = "";

      for (const candidate of packageCandidates) {
        const pkgJson = await this.readJson(path.resolve(workspaceRoot, candidate));
        if (!pkgJson) continue;
        if (hasNextDependency(pkgJson.dependencies) || hasNextDependency(pkgJson.devDependencies)) {
          matchedPackage = candidate;
          break;
        }
      }

      const passed = matchedPackage.length > 0;
      checks.push({
        id: "next-dependency",
        label: "Next.js dependency is installed",
        passed,
        detail: passed ? `Found in ${matchedPackage}.` : "Could not find `next` dependency in target package.json.",
        expected: "package.json dependencies.next",
        actual: matchedPackage || "not-found"
      });
      if (!passed) {
        missingTargets.push(packageCandidates[0] ?? "package.json");
        suggestions.push("Run `pnpm create next-app@latest <dir> --ts --eslint --tailwind --app --src-dir --use-pnpm --yes`.");
      }
    }

    const wantsShadcn = /shadcn/i.test(normalizedTopic);
    if (wantsShadcn) {
      const componentsCandidates =
        requestedDirectories.length > 0 ? requestedDirectories.map((directory) => `${directory}/components.json`) : ["components.json"];
      let matchedComponents = "";
      for (const candidate of componentsCandidates) {
        const stat = await this.statPath(path.resolve(workspaceRoot, candidate));
        if (stat?.isFile()) {
          matchedComponents = candidate;
          break;
        }
      }

      const packageCandidates = requestedDirectories.length > 0 ? requestedDirectories.map((directory) => `${directory}/package.json`) : ["package.json"];
      let shadcnDepsMatched = "";
      for (const candidate of packageCandidates) {
        const pkgJson = await this.readJson(path.resolve(workspaceRoot, candidate));
        if (!pkgJson) continue;
        if (hasShadcnSignals(pkgJson.dependencies) || hasShadcnSignals(pkgJson.devDependencies)) {
          shadcnDepsMatched = candidate;
          break;
        }
      }

      const passed = Boolean(matchedComponents) || Boolean(shadcnDepsMatched);
      checks.push({
        id: "shadcn-setup",
        label: "shadcn setup initialized",
        passed,
        detail: passed
          ? `Detected setup signal (${matchedComponents || shadcnDepsMatched}).`
          : "Neither components.json nor common shadcn dependencies were found.",
        expected: "components.json or shadcn-related dependencies",
        actual: matchedComponents || shadcnDepsMatched || "not-found"
      });

      if (!passed) {
        missingTargets.push(componentsCandidates[0] ?? "components.json");
        suggestions.push("Run `pnpm dlx shadcn@latest init --yes --cwd <dir>`.");
      }
    }

    if (checks.length === 0) {
      const changedPool = dedupeStrings([...input.changedFiles, ...input.filePaths]);
      checks.push({
        id: "generic-change-signal",
        label: "At least one target file is present for this run",
        passed: changedPool.length > 0,
        detail: changedPool.length > 0 ? `Detected ${changedPool.length} file target(s).` : "No changed or target files were detected.",
        expected: "non-empty changedFiles/filePaths",
        actual: String(changedPool.length)
      });
      if (changedPool.length === 0) {
        suggestions.push("Ensure implementation task selects and updates at least one target file.");
      }
    }

    const failedChecks = checks.filter((check) => !check.passed);
    const passed = failedChecks.length === 0;

    if (failedChecks.length > 0) {
      const failedLabels = failedChecks.map((check) => check.label).join(", ");
      suggestions.push(`Fix failed goals and retry: ${failedLabels}.`);
    }

    return {
      iteration: input.iteration,
      passed,
      summary: passed
        ? `Goal validation passed with ${checks.length} check(s).`
        : `Goal validation failed: ${failedChecks.length}/${checks.length} check(s) failed.`,
      checks,
      missingTargets: dedupeStrings(missingTargets),
      suggestions: dedupeStrings(suggestions)
    };
  }
}
