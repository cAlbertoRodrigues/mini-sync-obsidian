import { mountOnboarding } from "./ui/onboarding.js";
import { subscribeSyncStatus } from "./ui/providers/sync-provider.js";
import { loadVaults } from "./ui/state/vaults-store.js";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (!root) throw new Error("Mini Sync: #app não encontrado");
  mountOnboarding(root);
});

subscribeSyncStatus((p) => {
  // se você tiver uma função global de re-render, chama aqui
  // exemplo: rerenderSidebar()
  console.log("sync:status", p);
});