/**
 * Tipos de alteração que podem ocorrer em um arquivo monitorado.
 */
export type FileChangeType = "created" | "modified" | "deleted";

/**
 * Representa um evento de alteração detectado em um arquivo.
 */
export type FileChangeEvent = {
  /**
   * Tipo da alteração detectada.
   */
  type: FileChangeType;

  /**
   * Caminho relativo do arquivo afetado.
   */
  path: string;

  /**
   * Momento em que a alteração ocorreu.
   */
  occurredAt: Date;
};

/**
 * Opções utilizadas para iniciar um watcher de arquivos.
 */
export type FileWatcherOptions = {
  /**
   * Diretório raiz a ser monitorado.
   */
  rootDir: string;

  /**
   * Função responsável por determinar se um caminho deve ser ignorado.
   */
  ignore: (path: string) => boolean;
};

/**
 * Define o contrato de um sistema responsável por observar mudanças no filesystem.
 */
export interface FileWatcher {
  /**
   * Inicia o monitoramento de arquivos.
   *
   * @param options Configurações do watcher.
   */
  start(options: FileWatcherOptions): Promise<void>;

  /**
   * Interrompe o monitoramento.
   */
  stop(): Promise<void>;

  /**
   * Registra um handler que será chamado sempre que um evento ocorrer.
   *
   * @param handler Função que processa eventos de alteração.
   */
  onEvent(handler: (event: FileChangeEvent) => void): void;
}

/**
 * Representa o hash calculado para um arquivo.
 */
export type FileHash = {
  /**
   * Algoritmo utilizado para gerar o hash.
   */
  algorithm: "sha256";

  /**
   * Valor do hash em formato hexadecimal.
   */
  value: string;
};

/**
 * Define o contrato responsável por calcular hashes de arquivos.
 */
export interface FileHasher {
  /**
   * Calcula o hash de um arquivo no sistema de arquivos.
   *
   * @param absolutePath Caminho absoluto do arquivo.
   * @returns Hash calculado.
   */
  hashFile(absolutePath: string): Promise<FileHash>;
}