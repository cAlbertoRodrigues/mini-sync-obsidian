import fs from "node:fs/promises";
import path from "node:path";

const distRoot = path.resolve(process.cwd(), "dist");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && p.endsWith(".js")) out.push(p);
  }
  return out;
}

function needsJsExt(spec) {
  // só mexe em imports relativos
  if (!spec.startsWith("./") && !spec.startsWith("../")) return false;

  // já tem extensão?
  if (/\.[a-z0-9]+$/i.test(spec)) return false;

  // ignore diretórios (raríssimo em TS emit)
  if (spec.endsWith("/")) return false;

  return true;
}

function fixCode(code) {
  // 1) import ... from "..."
  code = code.replace(
    /(from\s+["'])([^"']+)(["'])/g,
    (m, a, spec, b) => (needsJsExt(spec) ? `${a}${spec}.js${b}` : m)
  );

  // 2) export ... from "..."
  code = code.replace(
    /(export\s+[^;]*?\sfrom\s+["'])([^"']+)(["'])/g,
    (m, a, spec, b) => (needsJsExt(spec) ? `${a}${spec}.js${b}` : m)
  );

  // 3) dynamic import("...")
  code = code.replace(
    /(import\(\s*["'])([^"']+)(["']\s*\))/g,
    (m, a, spec, b) => (needsJsExt(spec) ? `${a}${spec}.js${b}` : m)
  );

  return code;
}

const files = await walk(distRoot);

let changed = 0;
for (const file of files) {
  const before = await fs.readFile(file, "utf8");
  const after = fixCode(before);
  if (after !== before) {
    await fs.writeFile(file, after, "utf8");
    changed++;
  }
}

console.log(`fix-esm-imports: patched ${changed}/${files.length} js files`);
