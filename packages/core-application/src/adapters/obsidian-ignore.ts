import path from "node:path";

export function createObsidianIgnore(rootDir: string) {
  const root = path.resolve(rootDir);

  return (absPath: string) => {
    const p = path.resolve(absPath);

    // só ignora dentro do root
    if (!p.startsWith(root)) return true;

    const rel = path.relative(root, p).replaceAll("\\", "/");

    // Pastas internas do Obsidian
    if (rel.startsWith(".obsidian/")) return true;

    // Temporários comuns
    if (rel.endsWith("~")) return true;
    if (rel.endsWith(".tmp")) return true;
    if (rel.endsWith(".swp")) return true;
    if (rel.endsWith(".DS_Store")) return true;
    
    // Lixeira do Obsidian
    if (rel.startsWith(".trash/")) return true;
    // Mini Sync data
    if (rel.startsWith(".mini-sync/")) return true;

    return false;
  };
}
