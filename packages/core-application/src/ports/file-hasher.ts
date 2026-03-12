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
 *
 * Implementações podem usar diferentes bibliotecas ou mecanismos
 * de leitura de arquivo para produzir o hash.
 */
export interface FileHasher {
  /**
   * Calcula o hash de um arquivo no sistema de arquivos.
   *
   * @param absolutePath Caminho absoluto do arquivo.
   * @returns Hash calculado do arquivo.
   */
  hashFile(absolutePath: string): Promise<FileHash>;
}