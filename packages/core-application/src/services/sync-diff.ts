import type { Conflict, ConflictType } from "@mini-sync/core-domain";
import type { FileSyncState } from "../value-objects/file-sync-state";

/**
 * Representa um valor de hash em formato bruto, antes da normalização.
 */
type HashLike = unknown;

/**
 * Status resultante da comparação entre os estados local, remoto e sincronizado de um arquivo.
 */
export type FileStatus =
  | "unchanged"
  | "local_only"
  | "remote_only"
  | "synced"
  | "local_changed"
  | "remote_changed"
  | "conflict"
  | "unknown";

/**
 * Resultado da comparação de um arquivo específico.
 */
export type FileComparison = {
  /**
   * Caminho relativo do arquivo.
   */
  path: string;

  /**
   * Status calculado para o arquivo.
   */
  status: FileStatus;

  /**
   * Hash do último estado sincronizado.
   */
  lastSyncedHash?: string;

  /**
   * Hash atual local.
   */
  lastLocalHash?: string;

  /**
   * Hash atual remoto.
   */
  lastRemoteHash?: string;

  /**
   * Conflito detectado, quando existir.
   */
  conflict?: Conflict;
};

/**
 * Normaliza diferentes formatos possíveis de hash para string.
 *
 * @param h Valor bruto do hash.
 * @returns Hash normalizado ou `undefined`.
 */
function normalizeHash(h: HashLike): string | undefined {
  if (!h) return undefined;

  if (typeof h === "string") return h;

  if (typeof h === "object" && h !== null && "value" in h) {
    const value = (h as { value?: unknown }).value;
    if (typeof value === "string") return value;
  }

  return undefined;
}

/**
 * Verifica se o valor atual difere da base sincronizada.
 *
 * @param current Hash atual.
 * @param base Hash base sincronizado.
 * @returns `true` quando houver divergência em relação à base.
 */
function differsFromBase(current?: string, base?: string): boolean {
  if (!current) return false;
  if (!base) return true;
  return current !== base;
}

/**
 * Verifica se um valor é compatível com `FileSyncState`.
 *
 * @param value Valor a verificar.
 * @returns `true` quando o valor possuir a estrutura mínima esperada.
 */
function isFileSyncState(value: unknown): value is FileSyncState {
  if (!value || typeof value !== "object") return false;
  return "path" in value && typeof (value as { path?: unknown }).path === "string";
}

/**
 * Normaliza diferentes formatos de entrada para uma lista de `FileSyncState`.
 *
 * Formatos suportados:
 * - `FileSyncState[]`
 * - `Record<string, FileSyncState>`
 * - `{ files: Record<string, FileSyncState> }`
 *
 * @param states Estrutura bruta contendo estados.
 * @returns Lista normalizada de estados.
 */
function normalizeStatesInput(states: unknown): FileSyncState[] {
  if (!states) return [];

  if (Array.isArray(states)) {
    return states.filter(isFileSyncState);
  }

  if (typeof states !== "object") return [];

  if ("files" in states) {
    const files = (states as { files?: unknown }).files;
    if (files && typeof files === "object") {
      return Object.values(files as Record<string, unknown>).filter(isFileSyncState);
    }
  }

  return Object.values(states as Record<string, unknown>).filter(isFileSyncState);
}

/**
 * Detecta se um estado representa um conflito entre local e remoto.
 *
 * @param state Estado de sincronização do arquivo.
 * @returns Conflito detectado ou `null` quando não houver conflito.
 */
export function detectConflictFromState(state: FileSyncState): Conflict | null {
  const local = normalizeHash(state.lastLocalHash);
  const remote = normalizeHash(state.lastRemoteHash);
  const base = normalizeHash(state.lastSyncedHash);

  const localExists = !!local;
  const remoteExists = !!remote;

  const localChanged = localExists ? differsFromBase(local, base) : !!base;
  const remoteChanged = remoteExists ? differsFromBase(remote, base) : !!base;

  if (!localChanged && !remoteChanged) return null;

  if (localExists && remoteExists && local === remote) return null;

  if (localExists && remoteExists && localChanged && remoteChanged && local !== remote) {
    const type: ConflictType = "modified_modified";
    return {
      path: state.path,
      type,
      localHash: local,
      remoteHash: remote,
    };
  }

  if (!localExists && remoteExists && localChanged && remoteChanged) {
    const type: ConflictType = "deleted_modified";
    return {
      path: state.path,
      type,
      localHash: undefined,
      remoteHash: remote,
    };
  }

  if (localExists && !remoteExists && localChanged && remoteChanged) {
    const type: ConflictType = "modified_deleted";
    return {
      path: state.path,
      type,
      localHash: local,
      remoteHash: undefined,
    };
  }

  return null;
}

/**
 * Compara o estado de um arquivo e produz um status consolidado.
 *
 * @param state Estado de sincronização do arquivo.
 * @returns Resultado da comparação.
 */
export function compareFileState(state: FileSyncState): FileComparison {
  const local = normalizeHash(state.lastLocalHash);
  const remote = normalizeHash(state.lastRemoteHash);
  const base = normalizeHash(state.lastSyncedHash);

  const conflict = detectConflictFromState(state);

  if (conflict) {
    return {
      path: state.path,
      status: "conflict",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
      conflict,
    };
  }

  if (local && remote && base && local === base && remote === base) {
    return {
      path: state.path,
      status: "synced",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (local && remote && !base && local === remote) {
    return {
      path: state.path,
      status: "synced",
      lastSyncedHash: local,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (local && !differsFromBase(remote, base) && differsFromBase(local, base)) {
    return {
      path: state.path,
      status: base ? "local_changed" : "local_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (remote && !differsFromBase(local, base) && differsFromBase(remote, base)) {
    return {
      path: state.path,
      status: base ? "remote_changed" : "remote_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (local && !remote) {
    return {
      path: state.path,
      status: base ? "local_changed" : "local_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: undefined,
    };
  }

  if (!local && remote) {
    return {
      path: state.path,
      status: base ? "remote_changed" : "remote_only",
      lastSyncedHash: base,
      lastLocalHash: undefined,
      lastRemoteHash: remote,
    };
  }

  return {
    path: state.path,
    status: base ? "unchanged" : "unknown",
    lastSyncedHash: base,
    lastLocalHash: local,
    lastRemoteHash: remote,
  };
}

/**
 * Compara todos os estados informados e retorna a lista ordenada de comparações
 * junto com os conflitos detectados.
 *
 * @param states Estrutura contendo estados de sincronização.
 * @returns Comparações e conflitos encontrados.
 */
export function compareAllStates(states: unknown): {
  comparisons: FileComparison[];
  conflicts: Conflict[];
} {
  const list = normalizeStatesInput(states);

  const comparisons = list
    .map(compareFileState)
    .sort((a, b) => a.path.localeCompare(b.path));

  const conflicts = comparisons
    .filter((comparison) => comparison.status === "conflict" && comparison.conflict)
    .map((comparison) => comparison.conflict as Conflict);

  return { comparisons, conflicts };
}