import { el } from "../utils/dom.js";
import type { ChangeItem } from "../models/changes.js";
import { diffLines } from "../utils/line.diff.js";
import { threeWayMerge } from "../utils/three-way-merge.js";

type Props = {
  vaultId: string;
  onBack: () => void;
};

export async function renderVaultChangesView(props: Props): Promise<HTMLElement> {
  const wrap = el("div", { className: "ms-changes" });

  // topbar
  const top = el("div", { className: "ms-changes-top" });
  const back = el("button", { className: "ms-link-btn", textContent: "← Voltar" });
  back.addEventListener("click", props.onBack);
  const title = el("h2", { className: "ms-changes-title", textContent: "Changes" });
  top.append(back, title);

  // layout
  const body = el("div", { className: "ms-changes-body" });
  const list = el("div", { className: "ms-changes-list" });
  const panel = el("div", { className: "ms-changes-panel" });
  body.append(list, panel);

  wrap.append(top, body);

  const items = await window.miniSync.listChanges(props.vaultId);

if (items.length === 0) {
  wrap.append(el("p", { className: "ms-empty", textContent: "Nenhuma mudança encontrada." }));
  return wrap;
}

let selected: ChangeItem = items[0];


  function badge(status: ChangeItem["status"]) {
    const cls =
      status === "conflict" ? "ms-badge ms-badge--danger" :
      status === "local_changed" ? "ms-badge ms-badge--warn" :
      status === "remote_changed" ? "ms-badge ms-badge--info" :
      status === "both_changed" ? "ms-badge ms-badge--warn" :
      "ms-badge";
    return el("span", { className: cls, textContent: status });
  }

  function renderList() {
    list.replaceChildren();
    for (const it of items) {
      const row = el("button", { className: `ms-change-row ${it.path === selected.path ? "is-active" : ""}` });
      row.append(
        el("div", { className: "ms-change-path", textContent: it.path }),
        badge(it.status)
      );
      row.addEventListener("click", () => {
        selected = it;
        renderList();
        void renderPanel();
      });
      list.append(row);
    }
  }

  async function renderPanel() {
    panel.replaceChildren(
      el("div", { className: "ms-muted", textContent: "Carregando..." })
    );

    const filePath = selected.path;

    const [base, local, remote] = await Promise.all([
      window.miniSync.readFileSide(props.vaultId, filePath, "base").catch(() => ""),
      window.miniSync.readFileSide(props.vaultId, filePath, "local"),
      window.miniSync.readFileSide(props.vaultId, filePath, "remote"),
    ]);

    const actions = el("div", { className: "ms-change-actions" });

    const keepLocal = el("button", { className: "ms-btn ms-btn--default", textContent: "Keep Local" });
    keepLocal.addEventListener("click", async () => {
      await window.miniSync.acceptResolution(props.vaultId, filePath, "keep_local");
      alert("Resolvido: keep_local (MVP)");
    });

    const keepRemote = el("button", { className: "ms-btn ms-btn--default", textContent: "Keep Remote" });
    keepRemote.addEventListener("click", async () => {
      await window.miniSync.acceptResolution(props.vaultId, filePath, "keep_remote");
      alert("Resolvido: keep_remote (MVP)");
    });

    const manual = el("button", { className: "ms-btn ms-btn--primary", textContent: "Manual Merge" });
    manual.addEventListener("click", async () => {
      const result = prompt(
        "Cole aqui o conteúdo final do merge (MVP). Depois trocamos por modal 4 panes.\n\nDica: use Auto-merge primeiro."
      );
      if (result == null) return;
      await window.miniSync.saveMerged(props.vaultId, filePath, result);
      await window.miniSync.acceptResolution(props.vaultId, filePath, "manual_merge");
      alert("Merge salvo no LOCAL (MVP).");
    });

    const autoMerge = el("button", { className: "ms-btn ms-btn--default", textContent: "Auto-merge" });
    autoMerge.addEventListener("click", async () => {
      const r = threeWayMerge(base, local, remote);
      await window.miniSync.saveMerged(props.vaultId, filePath, r.text);
      alert(r.kind === "merged" ? "Auto-merge OK" : "Auto-merge gerou conflito markers");
    });

    actions.append(keepLocal, keepRemote, autoMerge, manual);

    // diff local vs base (ou remote vs base, dependendo do status)
    const leftLabel = el("div", { className: "ms-diff-label", textContent: "BASE → LOCAL" });
    const chunks = diffLines(base, local);

    const diff = el("div", { className: "ms-diff" });
    for (const c of chunks) {
      for (const line of c.lines) {
        const row = el("div", {
          className:
            c.op === "add" ? "ms-diff-line is-add" :
            c.op === "del" ? "ms-diff-line is-del" :
            "ms-diff-line",
          textContent:
            c.op === "add" ? `+ ${line}` :
            c.op === "del" ? `- ${line}` :
            `  ${line}`,
        });
        diff.append(row);
      }
    }

    panel.replaceChildren(
      el("div", { className: "ms-change-header" },),
    );

    const header = el("div", { className: "ms-change-header" });
    header.append(
      el("div", { className: "ms-change-file", textContent: filePath }),
      el("div", { className: "ms-muted", textContent: selected.summary })
    );

    panel.replaceChildren(header, actions, leftLabel, diff);
  }

  renderList();
  await renderPanel();

  return wrap;
}
