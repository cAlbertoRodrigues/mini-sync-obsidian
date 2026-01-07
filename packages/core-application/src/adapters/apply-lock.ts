import fs from "fs/promises";
import path from "path";

export function applyLockPath(vaultRoot: string) {
  return path.join(vaultRoot, ".mini-sync", "state", "applying.lock");
}

export async function setApplyLock(vaultRoot: string): Promise<void> {
  const fp = applyLockPath(vaultRoot);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, String(Date.now()), "utf-8");
}

export async function clearApplyLock(vaultRoot: string): Promise<void> {
  const fp = applyLockPath(vaultRoot);
  await fs.rm(fp, { force: true });
}

export async function isApplyLocked(vaultRoot: string): Promise<boolean> {
  const fp = applyLockPath(vaultRoot);
  try {
    await fs.stat(fp);
    return true;
  } catch {
    return false;
  }
}
