import fs from "node:fs/promises";
import path from "node:path";

import type {
  ConflictDecision,
  ConflictDecisionStore,
} from "../ports/conflict-decision-store";

type DecisionsFile = {
  decisions: ConflictDecision[];
};

export class NodeConflictDecisionStore implements ConflictDecisionStore {
  private decisionsFile(vaultRootAbs: string) {
    return path.join(vaultRootAbs, ".mini-sync", "conflicts", "decisions.json");
  }

  private async load(vaultRootAbs: string): Promise<DecisionsFile> {
    const file = this.decisionsFile(vaultRootAbs);
    try {
      const raw = await fs.readFile(file, "utf-8");
      return JSON.parse(raw) as DecisionsFile;
    } catch {
      return { decisions: [] };
    }
  }

  private async save(vaultRootAbs: string, data: DecisionsFile): Promise<void> {
    const dir = path.dirname(this.decisionsFile(vaultRootAbs));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.decisionsFile(vaultRootAbs),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }

  async get(vaultRootAbs: string, pathRel: string): Promise<ConflictDecision | null> {
    const data = await this.load(vaultRootAbs);
    return data.decisions.find((d) => d.path === pathRel) ?? null;
  }

  async set(vaultRootAbs: string, decision: ConflictDecision): Promise<void> {
    const data = await this.load(vaultRootAbs);
    const filtered = data.decisions.filter((d) => d.path !== decision.path);
    filtered.push(decision);
    await this.save(vaultRootAbs, { decisions: filtered });
  }

  async remove(vaultRootAbs: string, pathRel: string): Promise<void> {
    const data = await this.load(vaultRootAbs);
    const filtered = data.decisions.filter((d) => d.path !== pathRel);
    await this.save(vaultRootAbs, { decisions: filtered });
  }

  async list(vaultRootAbs: string): Promise<ConflictDecision[]> {
    const data = await this.load(vaultRootAbs);
    return data.decisions;
  }
}
