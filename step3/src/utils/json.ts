const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canParseJsonObject = (candidate: string): boolean => {
  try {
    return isJsonObject(JSON.parse(candidate));
  } catch {
    return false;
  }
};

const findFirstJsonObjectSlice = (text: string): string | null => {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < text.length; end += 1) {
      const ch = text[end];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          continue;
        }

        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        continue;
      }

      if (ch === "}") {
        depth -= 1;
        if (depth !== 0) {
          continue;
        }

        const candidate = text.slice(start, end + 1).trim();
        if (canParseJsonObject(candidate)) {
          return candidate;
        }
        break;
      }
    }
  }

  return null;
};

export const extractJsonObject = (text: string): string => {
  const fencedJsonPattern = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencedJsonPattern.exec(text)) !== null) {
    const fencedBody = match[1].trim();

    if (canParseJsonObject(fencedBody)) {
      return fencedBody;
    }

    const nested = findFirstJsonObjectSlice(fencedBody);
    if (nested) {
      return nested;
    }
  }

  const bare = findFirstJsonObjectSlice(text);
  if (bare) {
    return bare;
  }

  throw new Error("No JSON object found in model output.");
};
