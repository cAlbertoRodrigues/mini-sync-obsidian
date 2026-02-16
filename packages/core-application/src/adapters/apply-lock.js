import fs from "fs/promises";
import path from "path";
export function applyLockPath(vaultRoot) {
    return path.join(vaultRoot, ".mini-sync", "state", "applying.lock");
}
export async function setApplyLock(vaultRoot) {
    const fp = applyLockPath(vaultRoot);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, String(Date.now()), "utf-8");
}
export async function clearApplyLock(vaultRoot) {
    const fp = applyLockPath(vaultRoot);
    await fs.rm(fp, { force: true });
}
export async function isApplyLocked(vaultRoot) {
    const fp = applyLockPath(vaultRoot);
    try {
        await fs.stat(fp);
        return true;
    }
    catch {
        return false;
    }
}
