import { el } from "../utils/dom";
import type { VaultItem } from "../onboarding";

type Props = {
  vault: VaultItem;
  onBack: () => void;
  onContinue: () => void;
};

export function renderVaultSetupView(props: Props): HTMLElement {
  const wrap = el("div", { className: "ms-setup" });

  const top = el("div", { className: "ms-setup-top" });
  const back = el("button", { className: "ms-link-btn", textContent: "← Voltar" });
  back.addEventListener("click", props.onBack);

  const heading = el("div", { className: "ms-setup-heading" });
  heading.append(
    el("h2", { className: "ms-setup-title", textContent: props.vault.name }),
    el("p", {
      className: "ms-setup-subtitle",
      textContent:
        props.vault.provider === "local"
          ? "Configuração local antes de abrir o Obsidian."
          : "Configuração remota antes de abrir o Obsidian.",
    })
  );

  top.append(back, heading);

  const card = el("div", { className: "ms-card" });

  // aqui é “simples”, depois você liga com seus serviços reais (core-application)
  const row1 = fieldRow(
    "Provider",
    props.vault.provider === "local" ? "Local" : props.vault.remoteLabel ?? "Remoto"
  );
  const row2 = fieldRow(
    props.vault.provider === "local" ? "Caminho" : "Destino remoto",
    props.vault.provider === "local"
      ? props.vault.localPath ?? "-"
      : props.vault.remotePath ?? "-"
  );

  card.append(row1, row2);

  const footer = el("div", { className: "ms-setup-footer" });
  const continueBtn = el("button", { className: "ms-primary", textContent: "Continuar" });
  continueBtn.addEventListener("click", props.onContinue);
  footer.append(continueBtn);

  wrap.append(top, card, footer);
  return wrap;
}

function fieldRow(label: string, value: string): HTMLElement {
  const row = el("div", { className: "ms-field" });
  row.append(
    el("div", { className: "ms-field-label", textContent: label }),
    el("div", { className: "ms-field-value", textContent: value })
  );
  return row;
}
