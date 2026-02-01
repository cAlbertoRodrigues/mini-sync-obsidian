import { describe, it, expect } from "vitest";
import { compareFileState, detectConflictFromState } from "./sync-diff.js";

// Tipo mínimo compatível com o que o serviço usa.
// (Não importa o resto do shape do FileSyncState, só o que o código acessa)
type HashObj = { algorithm?: string; value?: string };

type FileSyncStateLike = {
  path: string;
  lastSyncedHash?: string | HashObj | null;
  lastLocalHash?: string | HashObj | null;
  lastRemoteHash?: string | HashObj | null;
};

function s(
  path: string,
  base?: FileSyncStateLike["lastSyncedHash"],
  local?: FileSyncStateLike["lastLocalHash"],
  remote?: FileSyncStateLike["lastRemoteHash"]
): FileSyncStateLike {
  return { path, lastSyncedHash: base, lastLocalHash: local, lastRemoteHash: remote };
}

describe("file-compare", () => {
  it("returns synced when base/local/remote are equal", () => {
    const r = compareFileState(s("a.md", "h1", "h1", "h1") as any);
    expect(r.status).toBe("synced");
  });

  it("returns synced when base is missing but local == remote", () => {
    const r = compareFileState(s("a.md", undefined, "h1", "h1") as any);
    expect(r.status).toBe("synced");
    expect(r.lastSyncedHash).toBe("h1"); // base normalizado como local
  });

  it("returns local_only when base missing and only local exists", () => {
    const r = compareFileState(s("a.md", undefined, "h1", undefined) as any);
    expect(r.status).toBe("local_only");
  });

  it("returns remote_only when base missing and only remote exists", () => {
    const r = compareFileState(s("a.md", undefined, undefined, "h1") as any);
    expect(r.status).toBe("remote_only");
  });

  it("returns local_changed when base exists and local differs while remote equals base", () => {
    const r = compareFileState(s("a.md", "base", "local", "base") as any);
    expect(r.status).toBe("local_changed");
  });

  it("returns remote_changed when base exists and remote differs while local equals base", () => {
    const r = compareFileState(s("a.md", "base", "base", "remote") as any);
    expect(r.status).toBe("remote_changed");
  });

  it("returns conflict modified_modified when both changed and differ", () => {
    const c = detectConflictFromState(s("a.md", "base", "l", "r") as any);
    expect(c?.type).toBe("modified_modified");
    expect(c?.path).toBe("a.md");
    expect(c?.localHash).toBe("l");
    expect(c?.remoteHash).toBe("r");
  });

  it("returns conflict deleted_modified when local missing and remote changed", () => {
    const c = detectConflictFromState(s("a.md", "base", undefined, "r") as any);
    expect(c?.type).toBe("deleted_modified");
    expect(c?.localHash).toBeUndefined();
    expect(c?.remoteHash).toBe("r");
  });

  it("returns conflict modified_deleted when remote missing and local changed", () => {
    const c = detectConflictFromState(s("a.md", "base", "l", undefined) as any);
    expect(c?.type).toBe("modified_deleted");
    expect(c?.localHash).toBe("l");
    expect(c?.remoteHash).toBeUndefined();
  });

  it("accepts hash objects ({value}) as input", () => {
    const local: HashObj = { algorithm: "sha256", value: "l" };
    const remote: HashObj = { algorithm: "sha256", value: "r" };
    const base: HashObj = { algorithm: "sha256", value: "b" };

    const c = detectConflictFromState(s("a.md", base, local, remote) as any);
    expect(c?.type).toBe("modified_modified");
    expect(c?.localHash).toBe("l");
    expect(c?.remoteHash).toBe("r");
  });
});
