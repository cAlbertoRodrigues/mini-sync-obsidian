import path from "node:path";

/**
 * Cria uma função de filtro para ignorar arquivos e diretórios
 * que não devem ser processados pelo sistema de sincronização.
 *
 * O filtro é utilizado principalmente pelo `FileWatcher`
 * para evitar eventos irrelevantes ou internos do Obsidian
 * e do próprio Mini Sync.
 *
 * @param rootDir Caminho absoluto da raiz do vault.
 * @returns Função que determina se um caminho deve ser ignorado.
 */
export function createObsidianIgnore(rootDir: string) {
  const root = path.resolve(rootDir);

  /**
   * Verifica se um caminho deve ser ignorado.
   *
   * @param absPath Caminho absoluto do arquivo ou diretório.
   * @returns `true` quando o caminho deve ser ignorado.
   */
  return (absPath: string) => {
    const p = path.resolve(absPath);

    // Ignora qualquer caminho fora do vault
    if (!p.startsWith(root)) return true;

    const rel = path.relative(root, p).replaceAll("\\", "/");

    /**
     * Pastas internas do Obsidian
     */
    if (rel.startsWith(".obsidian/")) return true;

    /**
     * Arquivos temporários comuns
     */
    if (rel.endsWith("~")) return true;
    if (rel.endsWith(".tmp")) return true;
    if (rel.endsWith(".swp")) return true;
    if (rel.endsWith(".DS_Store")) return true;

    /**
     * Lixeira do Obsidian
     */
    if (rel.startsWith(".trash/")) return true;

    /**
     * Metadados internos do Mini Sync
     */
    if (rel.startsWith(".mini-sync/")) return true;

    return false;
  };
}