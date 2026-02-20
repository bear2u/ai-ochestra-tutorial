import { ApprovalRiskLevel } from "../types";

export interface CommandPolicyDecision {
  action: "allow" | "approval" | "reject";
  reason: string;
  riskLevel: ApprovalRiskLevel;
}

const hasUnsafeShellChars = (command: string): boolean => /[;&|><`$]/.test(command);

const isDangerous = (command: string): boolean => /\b(reset\s+--hard|rm\s+-rf|del\s+\/f|shutdown|reboot|mkfs|dd\s+if=|format\s+)\b/i.test(command);

const needsApproval = (command: string): boolean => /\b(deploy|publish|push|release|prod|production|vercel|netlify|flyctl|aws\s+)\b/i.test(command);

const isInstallFamily = (command: string): boolean =>
  /^(pnpm|npm)\s+(install|i|add|remove|rm|update|up|dlx|create|init)\b/i.test(command.trim());

const isValidationFamily = (command: string): boolean =>
  /^(pnpm|npm)\s+(lint|typecheck|test|build)\b/i.test(command.trim()) ||
  /^(pnpm|npm)\s+run\s+(lint|typecheck|test|build)\b/i.test(command.trim());

const isWindowsAbsolutePath = (value: string): boolean => /^[a-zA-Z]:[\\/]/.test(value);
const hasParentTraversal = (value: string): boolean =>
  value
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .some((segment) => segment === "..");

const parseScopedCommand = (command: string): { directory: string; innerCommand: string } | undefined => {
  const match = command.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|><`$]+))\s*&&\s*(.+)$/i);
  if (!match) return undefined;
  const directory = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const innerCommand = (match[4] ?? "").trim();
  if (!directory || !innerCommand) return undefined;
  return {
    directory,
    innerCommand
  };
};

const isSafeScopedDirectory = (directory: string): boolean => {
  if (!directory) return false;
  if (directory.includes("~")) return false;
  if (directory.startsWith("/")) return false;
  if (isWindowsAbsolutePath(directory)) return false;
  if (hasParentTraversal(directory)) return false;
  if (!/^[a-zA-Z0-9._/-]+$/.test(directory)) return false;
  return true;
};

export class CommandPolicy {
  evaluate(command: string, approvedCommands: ReadonlySet<string> = new Set()): CommandPolicyDecision {
    const normalized = command.trim();

    if (!normalized) {
      return {
        action: "reject",
        reason: "Empty command is not allowed.",
        riskLevel: "high"
      };
    }

    const scoped = parseScopedCommand(normalized);
    const commandForPolicy = scoped?.innerCommand ?? normalized;

    if (scoped && !isSafeScopedDirectory(scoped.directory)) {
      return {
        action: "reject",
        reason: `Unsafe scoped command path: ${scoped.directory}`,
        riskLevel: "high"
      };
    }

    if (approvedCommands.has(normalized) || approvedCommands.has(commandForPolicy)) {
      return {
        action: "allow",
        reason: "Previously approved command.",
        riskLevel: "low"
      };
    }

    if (hasUnsafeShellChars(commandForPolicy) || isDangerous(commandForPolicy)) {
      return {
        action: "reject",
        reason: "Command contains unsafe shell operators or destructive patterns.",
        riskLevel: "high"
      };
    }

    if (!/^(pnpm|npm)\s+/i.test(commandForPolicy)) {
      return {
        action: "approval",
        reason: "Non npm/pnpm commands require explicit approval.",
        riskLevel: "medium"
      };
    }

    if (needsApproval(commandForPolicy)) {
      return {
        action: "approval",
        reason: "Deployment/release style command requires approval.",
        riskLevel: "high"
      };
    }

    if (isInstallFamily(commandForPolicy) || isValidationFamily(commandForPolicy)) {
      return {
        action: "allow",
        reason: "Install/build/validation command allowed by policy.",
        riskLevel: "low"
      };
    }

    return {
      action: "approval",
      reason: "Command is not in allowlist. Approval required.",
      riskLevel: "medium"
    };
  }
}
