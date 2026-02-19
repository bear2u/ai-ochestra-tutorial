import { applyPatch as applyTextPatch } from "diff";

const withSyntheticHeaders = (patch: string): string => {
  if (/^---\s/m.test(patch) || /^diff --git\s/m.test(patch)) {
    return patch;
  }

  return ["--- a/file", "+++ b/file", patch].join("\n");
};

export const applyUnifiedPatch = (original: string, patch: string): string => {
  const trimmed = patch.trim();
  if (!trimmed) {
    throw new Error("Patch text is empty.");
  }
  if (!trimmed.includes("@@")) {
    throw new Error("Patch does not include unified diff hunks.");
  }

  const candidates = [patch, withSyntheticHeaders(patch)];
  for (const candidate of candidates) {
    const applied = applyTextPatch(original, candidate, { fuzzFactor: 1 });
    if (typeof applied === "string") {
      return applied;
    }
  }

  throw new Error("Failed to apply unified patch.");
};
