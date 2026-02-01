export type VaultProviderId = "local" | "google-drive";

export type ProviderDefinition = {
  id: VaultProviderId;
  label: string;
  description: string;
};

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
