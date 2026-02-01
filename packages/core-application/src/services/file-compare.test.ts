import { describe, expect, it } from "vitest";
import { compareFileState, detectConflictFromState } from "./sync-diff.js";

type CompareInput = Parameters<typeof compareFileState>[0];

/**
 * Cria um "estado" mínimo para os testes.
 * Usamos `unknown as CompareInput` para evitar `any` e ainda permitir testes
 * sem precisar montar todos os campos obrigatórios do estado real.
 */
function s(
  path: string,
  lastSyncedHash?: unknown,
  lastLocalHash?: unknown,
  lastRemoteHash?: unknown
): CompareInput {
  return {
    path,
    lastSyncedHash,
    lastLocalHash,
    lastRemoteHash,
  } as unknown as CompareInput;
}

describe("file-compare", () => {
  it("ok: quando synced/local/remote são iguais", () => {
    const r = compareFileState(s("a.md", "h1", "h1", "h1"));
    expect(r.status).toBe("synced");
  });

  it("localChanged: quando local difere do synced", () => {
    const r = compareFileState(s("a.md", "h1", "h2", "h1"));
    expect(r.status).toBe("local_changed");
  });

  it("remoteChanged: quando remote difere do synced", () => {
    const r = compareFileState(s("a.md", "h1", "h1", "h2"));
    expect(r.status).toBe("remote_changed");
  });

  it("bothChanged: quando local e remote diferem do synced (mas são iguais entre si)", () => {
    const r = compareFileState(s("a.md", "h1", "h2", "h2"));
    expect(r.status).toBe("unchanged");
  });

  it("conflict: quando local e remote diferem entre si e ambos diferem do synced", () => {
    const r = compareFileState(s("a.md", "base", "local", "remote"));
    expect(r.status).toBe("conflict");
  });

  it("conflict detection: modified_modified", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", "remote"));
    expect(c?.type).toBe("modified_modified");
  });

  it("conflict detection: deleted_modified (local deleted)", () => {
    const c = detectConflictFromState(s("a.md", "base", undefined, "remote"));
    expect(c?.type).toBe("deleted_modified");
  });

  it("conflict detection: deleted_modified (remote deleted)", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", undefined));
    expect(c?.type).toBe("modified_deleted");
  });

  it("no conflict: only local changed", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", "base"));
    expect(c).toBe(null);
  });

  it("no conflict: only remote changed", () => {
    const c = detectConflictFromState(s("a.md", "base", "base", "remote"));
    expect(c).toBe(null);
  });
});
