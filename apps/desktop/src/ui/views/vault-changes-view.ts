import type { ChangeRow, ConflictStrategyUi } from "../models/changes.js";
import { loadChanges, runSyncNow } from "../providers/sync-provider.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

async function acceptResolution(vaultId: string, filePath: string, strategy: ConflictStrategyUi) {
  await window.api.invoke("changes:acceptResolution", { vaultId, filePath, strategy });
}

export async function renderVaultChangesView(opts: {
  root: HTMLElement;
  vaultId: string;
  remoteRootDir: string;
}) {
  const { root, vaultId, remoteRootDir } = opts;

  root.innerHTML = "";

  const header = el("div", "view-header");
  const title = el("h2");
  title.textContent = "Changes & Conflicts";

  const actions = el("div", "view-actions");
  const syncBtn = el("button", "btn btn-primary");
  syncBtn.textContent = "Sync now";
  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    try {
      await runSyncNow({ vaultId, remoteRootDir, defaultStrategy: "local" });
      await refresh();
    } finally {
      syncBtn.disabled = false;
    }
  };

  const refreshBtn = el("button", "btn");
  refreshBtn.textContent = "Refresh";
  refreshBtn.onclick = async () => refresh();

  actions.appendChild(syncBtn);
  actions.appendChild(refreshBtn);

  header.appendChild(title);
  header.appendChild(actions);

  const list = el("div", "changes-list");
  root.appendChild(header);
  root.appendChild(list);

  async function refresh() {
    list.innerHTML = "";
    const rows = await loadChanges(vaultId);

    if (rows.length === 0) {
      const empty = el("div", "empty");
      empty.textContent = "No changes.";
      list.appendChild(empty);
      return;
    }

    const conflicts = rows.filter((r) => r.status === "conflict");

    if (conflicts.length > 0) {
      const banner = el("div", "banner banner-warning");
      banner.textContent = `⚠️ ${conflicts.length} conflict(s) detected. Resolve them and re-sync.`;
      list.appendChild(banner);
    }

    for (const r of rows) {
      const card = el("div", `change-card status-${r.status}`);

      const top = el("div", "change-top");
      const pathEl = el("div", "change-path");
      pathEl.textContent = r.path;

      const statusEl = el("div", "change-status");
      statusEl.textContent = r.summary;

      top.appendChild(pathEl);
      top.appendChild(statusEl);
      card.appendChild(top);

      if (r.status === "conflict") {
        const row = el("div", "conflict-actions");

        const keepLocal = el("button", "btn btn-primary");
        keepLocal.textContent = "Keep local";
        keepLocal.onclick = async () => {
          await acceptResolution(vaultId, r.path, "keep_local");
          await runSyncNow({ vaultId, remoteRootDir, defaultStrategy: "local" }); // ✅ re-sync
          await refresh();
        };

        const keepRemote = el("button", "btn");
        keepRemote.textContent = "Keep remote";
        keepRemote.onclick = async () => {
          await acceptResolution(vaultId, r.path, "keep_remote");
          await runSyncNow({ vaultId, remoteRootDir, defaultStrategy: "remote" }); // ✅ re-sync
          await refresh();
        };

        const manual = el("button", "btn");
        manual.textContent = "Manual merge";
        manual.onclick = async () => {
          // MVP: marca decisão e deixa usuário editar (você já tem saveMerged)
          await acceptResolution(vaultId, r.path, "manual_merge");

          // Você pode abrir um editor aqui (3-way) depois.
          // Por agora: só re-sync (vai considerar sua decisão + conteúdo local após salvar)
          await runSyncNow({ vaultId, remoteRootDir, defaultStrategy: "local" });
          await refresh();
        };

        row.appendChild(keepLocal);
        row.appendChild(keepRemote);
        row.appendChild(manual);
        card.appendChild(row);
      }

      list.appendChild(card);
    }
  }

  await refresh();
}
