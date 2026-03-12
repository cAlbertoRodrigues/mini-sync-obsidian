/**
 * Identificadores suportados de provedores de sincronização.
 *
 * Cada valor representa uma implementação possível de backend
 * responsável por armazenar e sincronizar os arquivos do vault.
 */
export type VaultProviderId = "local" | "google-drive";

/**
 * Define a estrutura de metadados utilizada para descrever
 * um provedor de sincronização disponível na interface.
 */
export type ProviderDefinition = {
	/**
	 * Identificador único do provedor.
	 */
	id: VaultProviderId;

	/**
	 * Nome exibido na interface para o usuário.
	 */
	label: string;

	/**
	 * Descrição breve explicando como o provedor funciona.
	 */
	description: string;
};

/**
 * Lista de provedores de sincronização disponíveis no aplicativo.
 *
 * Cada item descreve um backend que pode ser utilizado para
 * sincronizar o vault do usuário.
 */
export const PROVIDERS: ProviderDefinition[] = [
	{
		id: "local",
		label: "Local",
		description: "Sincronização via pasta local/remota (MVP).",
	},
	{
		id: "google-drive",
		label: "Google Drive",
		description: "Sincronização via Google Drive (em evolução).",
	},
];
