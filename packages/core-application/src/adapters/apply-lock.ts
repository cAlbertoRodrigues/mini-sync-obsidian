import fs from "node:fs/promises";
import path from "node:path";

/**
 * Retorna o caminho do arquivo de lock utilizado durante a aplicação
 * de eventos de sincronização no vault.
 *
 * O lock é usado para evitar que mudanças aplicadas pelo próprio
 * Mini Sync sejam interpretadas como alterações locais pelo watcher.
 *
 * @param vaultRoot Caminho absoluto da raiz do vault.
 * @returns Caminho absoluto do arquivo de lock.
 */
export function applyLockPath(vaultRoot: string) {
  return path.join(vaultRoot, ".mini-sync", "state", "applying.lock");
}

/**
 * Cria o lock de aplicação de eventos.
 *
 * Este lock indica que o sistema está aplicando mudanças vindas
 * da sincronização remota, impedindo que o watcher trate essas
 * mudanças como alterações locais do usuário.
 *
 * @param vaultRoot Caminho absoluto da raiz do vault.
 */
export async function setApplyLock(vaultRoot: string): Promise<void> {
  const fp = applyLockPath(vaultRoot);

  await fs.mkdir(path.dirname(fp), { recursive: true });

  await fs.writeFile(fp, String(Date.now()), "utf-8");
}

/**
 * Remove o lock de aplicação de eventos.
 *
 * Deve ser chamado após a finalização do processo de aplicação
 * das mudanças sincronizadas.
 *
 * @param vaultRoot Caminho absoluto da raiz do vault.
 */
export async function clearApplyLock(vaultRoot: string): Promise<void> {
  const fp = applyLockPath(vaultRoot);

  await fs.rm(fp, { force: true });
}

/**
 * Verifica se existe um lock ativo de aplicação de eventos.
 *
 * Quando verdadeiro, significa que o sistema está atualmente
 * aplicando mudanças vindas do processo de sincronização.
 *
 * @param vaultRoot Caminho absoluto da raiz do vault.
 * @returns `true` se o lock estiver ativo.
 */
export async function isApplyLocked(vaultRoot: string): Promise<boolean> {
  const fp = applyLockPath(vaultRoot);

  try {
    await fs.stat(fp);
    return true;
  } catch {
    return false;
  }
}