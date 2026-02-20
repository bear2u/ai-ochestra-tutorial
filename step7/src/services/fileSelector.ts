import { DiscoveryCandidate } from "../types";
import { IndexedFile } from "./workspaceIndexer";

export interface FileSelectorInput {
  topic: string;
  candidates: IndexedFile[];
  recentFiles?: string[];
  topN?: number;
}

const tokenize = (text: string): string[] => {
  const normalized = text.toLowerCase();
  return [...new Set(normalized.split(/[^a-z0-9가-힣_./-]+/g).map((token) => token.trim()).filter((token) => token.length >= 2))];
};

const containsAny = (source: string, words: string[]): boolean => words.some((word) => source.includes(word));

export class FileSelector {
  select(input: FileSelectorInput): { selectedFiles: string[]; scoredCandidates: DiscoveryCandidate[] } {
    const topN = Math.max(1, Math.min(input.topN ?? 12, 40));
    const topic = input.topic.toLowerCase();
    const tokens = tokenize(input.topic);
    const recent = new Set((input.recentFiles ?? []).map((item) => item.trim()).filter(Boolean));

    const scored = input.candidates.map((candidate) => {
      let score = 0;
      const reasons: string[] = [];
      const lowerPath = candidate.path.toLowerCase();

      if (topic.includes(lowerPath)) {
        score += 100;
        reasons.push("topic_explicit_path");
      }

      for (const token of tokens) {
        if (!token) continue;
        if (lowerPath.includes(token)) {
          const weight = token.length >= 5 ? 14 : 8;
          score += weight;
          reasons.push(`token:${token}`);
        }
      }

      if (containsAny(topic, ["next", "nextjs"]) && (lowerPath.includes("src/app") || lowerPath.includes("next.config") || lowerPath === "package.json")) {
        score += 35;
        reasons.push("next_hint");
      }

      if (containsAny(topic, ["shadcn", "ui", "component"]) && (lowerPath.includes("components") || lowerPath.includes("src/app") || lowerPath.includes("tailwind") || lowerPath.includes("package.json"))) {
        score += 22;
        reasons.push("ui_hint");
      }

      if (containsAny(topic, ["todo", "kanban", "칸반"]) && (lowerPath.includes("todo") || lowerPath.includes("kanban") || lowerPath.includes("board") || lowerPath.includes("src/app"))) {
        score += 30;
        reasons.push("feature_hint");
      }

      if (recent.has(candidate.path)) {
        score += 15;
        reasons.push("recent_file");
      }

      if (lowerPath.includes("test") || lowerPath.includes("spec")) {
        score += 7;
        reasons.push("test_file");
      }

      if (lowerPath === "package.json") {
        score += 10;
        reasons.push("manifest");
      }

      return {
        path: candidate.path,
        score,
        reasons
      } satisfies DiscoveryCandidate;
    });

    const ordered = scored.sort((a, b) => (a.score === b.score ? (a.path > b.path ? 1 : -1) : b.score - a.score));
    let selected = ordered.filter((candidate) => candidate.score > 0).slice(0, topN).map((candidate) => candidate.path);

    if (selected.length === 0) {
      const fallbackPriority = ["package.json", "src/app/page.tsx", "src/main.ts", "README.md", "readme.md"];
      const fallbackSet = new Set<string>();
      for (const target of fallbackPriority) {
        const found = input.candidates.find((candidate) => candidate.path.toLowerCase() === target.toLowerCase());
        if (found) fallbackSet.add(found.path);
      }

      if (fallbackSet.size === 0) {
        for (const candidate of input.candidates.slice(0, topN)) {
          fallbackSet.add(candidate.path);
        }
      }

      selected = [...fallbackSet].slice(0, topN);
    }

    return {
      selectedFiles: selected,
      scoredCandidates: ordered.slice(0, Math.max(topN, 20))
    };
  }
}
