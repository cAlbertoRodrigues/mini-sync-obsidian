import { describe, expect, it } from "vitest";
import { compareFileState, detectConflictFromState } from "./sync-diff.js";

type CompareInput = Parameters<typeof compareFileState>[0];

/**
 * Cria um estado mínimo de comparação para testes.
 *
 * A conversão `unknown as CompareInput` permite montar apenas os campos
 * necessários para os cenários testados sem depender da estrutura completa
 * do estado real.
 *
 * @param path Caminho do arquivo.
 * @param lastSyncedHash Hash do último estado sincronizado.
 * @param lastLocalHash Hash atual local.
 * @param lastRemoteHash Hash atual remoto.
 */
function s(
  path: string,
  lastSyncedHash?: unknown,
  lastLocalHash?: unknown,
  lastRemoteHash?: unknown,
): CompareInput {
  return {
    path,
    lastSyncedHash,
    lastLocalHash,
    lastRemoteHash,
  } as unknown as CompareInput;
}

describe("file-compare", () => {
  it("returns synced when hashes are equal", () => {
    const r = compareFileState(s("a.md", "h1", "h1", "h1"));
    expect(r.status).toBe("synced");
  });

  it("detects local change", () => {
    const r = compareFileState(s("a.md", "h1", "h2", "h1"));
    expect(r.status).toBe("local_changed");
  });

  it("detects remote change", () => {
    const r = compareFileState(s("a.md", "h1", "h1", "h2"));
    expect(r.status).toBe("remote_changed");
  });

  it("detects unchanged when local and remote match each other but differ from synced", () => {
    const r = compareFileState(s("a.md", "h1", "h2", "h2"));
    expect(r.status).toBe("unchanged");
  });

  it("detects conflict when local and remote diverge from synced and from each other", () => {
    const r = compareFileState(s("a.md", "base", "local", "remote"));
    expect(r.status).toBe("conflict");
  });

  it("detects modified_modified conflict", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", "remote"));
    expect(c?.type).toBe("modified_modified");
  });

  it("detects deleted_modified conflict when local deleted", () => {
    const c = detectConflictFromState(s("a.md", "base", undefined, "remote"));
    expect(c?.type).toBe("deleted_modified");
  });

  it("detects modified_deleted conflict when remote deleted", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", undefined));
    expect(c?.type).toBe("modified_deleted");
  });

  it("returns null when only local changed", () => {
    const c = detectConflictFromState(s("a.md", "base", "local", "base"));
    expect(c).toBe(null);
  });

  it("returns null when only remote changed", () => {
    const c = detectConflictFromState(s("a.md", "base", "base", "remote"));
    expect(c).toBe(null);
  });
});