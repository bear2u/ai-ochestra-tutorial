export class FileLockManager {
  private readonly byFile = new Map<string, string>();

  tryAcquire(taskId: string, files: string[]): boolean {
    const normalized = [...new Set(files.map((item) => item.trim()).filter(Boolean))];
    if (normalized.length === 0) {
      return true;
    }

    for (const filePath of normalized) {
      const owner = this.byFile.get(filePath);
      if (owner && owner !== taskId) {
        return false;
      }
    }

    for (const filePath of normalized) {
      this.byFile.set(filePath, taskId);
    }
    return true;
  }

  release(taskId: string): void {
    for (const [filePath, owner] of this.byFile.entries()) {
      if (owner === taskId) {
        this.byFile.delete(filePath);
      }
    }
  }
}
