/**
 * Representa um arquivo dentro de um manifesto de snapshot.
 *
 * Cada entrada descreve o estado de um arquivo em um determinado
 * momento do vault.
 */
export type SnapshotManifestFile = {
  /**
   * Caminho relativo do arquivo dentro do vault (formato POSIX).
   */
  path: string;

  /**
   * Hash SHA-256 do conteúdo do arquivo.
   */
  sha256: string;

  /**
   * Tamanho do arquivo em bytes.
   */
  sizeBytes: number;

  /**
   * Timestamp de modificação do arquivo em milissegundos.
   */
  mtimeMs: number;

  /**
   * Conteúdo textual inline do arquivo.
   *
   * Utilizado quando o arquivo é pequeno e textual,
   * permitindo bootstrap mais rápido do vault.
   */
  inlineTextUtf8?: string;

  /**
   * Referência ao blob armazenado externamente.
   *
   * Utilizado quando o arquivo é grande ou binário.
   */
  blobSha256?: string;
};

/**
 * Manifesto de snapshot representando o estado completo de um vault.
 *
 * O manifesto lista todos os arquivos presentes no vault em um
 * determinado momento, incluindo metadados e referências a blobs
 * quando necessário.
 */
export type SnapshotManifest = {
  /**
   * Identificador único do snapshot.
   */
  id: string;

  /**
   * Identificador do vault ao qual o snapshot pertence.
   */
  vaultId: string;

  /**
   * Timestamp ISO indicando quando o snapshot foi criado.
   */
  createdAtIso: string;

  /**
   * Lista de arquivos incluídos no snapshot.
   */
  files: SnapshotManifestFile[];
};