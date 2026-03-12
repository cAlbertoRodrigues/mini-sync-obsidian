import { mountOnboarding } from "./ui/onboarding.js";
import { subscribeSyncStatus } from "./ui/providers/sync-provider.js";

/**
 * Inicializa a interface do renderer process quando o DOM estiver pronto.
 *
 * O fluxo de inicialização:
 * - localiza o elemento raiz da aplicação
 * - monta a interface de onboarding
 * - registra a escuta de eventos de status de sincronização enviados pelo main process
 */
window.addEventListener("DOMContentLoaded", () => {
	const root = document.getElementById("app");
	if (!root) return;

	mountOnboarding(root);

	subscribeSyncStatus(() => {});
});