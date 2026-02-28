/* eslint-env node */

import fs from "fs";
import path from "path";

const distDir = path.resolve("dist");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.isFile() && p.endsWith(".js")) files.push(p);
  }

  return files;
}

function hasExtension(spec) {
  return /\.[a-zA-Z0-9]+$/.test(spec);
}

function shouldPatch(spec) {
  // só mexe em imports relativos
  if (!spec.startsWith("./") && !spec.startsWith("../")) return false;

  // já tem extensão
  if (hasExtension(spec)) return false;

  // ignora casos com query/hash (raros)
  if (spec.includes("?") || spec.includes("#")) return false;

  return true;
}

function patchFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");

  // cobre: import ... from "./x"
  //        export ... from "./x"
  //        import("./x")
  const patched = original.replace(
    /(from\s+["'])([^"']+)(["'])|(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g,
    (m, p1, spec1, p3, p4, spec2, p6) => {
      const spec = spec1 ?? spec2;
      if (!spec || !shouldPatch(spec)) return m;

      // tenta resolver se existe arquivo .js ou index.js
      const abs = path.resolve(path.dirname(filePath), spec);
      const jsFile = abs + ".js";
      const indexJs = path.join(abs, "index.js");

      if (fs.existsSync(jsFile)) {
        const replaced = spec + ".js";
        if (spec1) return `${p1}${replaced}${p3}`;
        return `${p4}${replaced}${p6}`;
      }

      if (fs.existsSync(indexJs)) {
        const replaced = spec + "/index.js";
        if (spec1) return `${p1}${replaced}${p3}`;
        return `${p4}${replaced}${p6}`;
      }

      return m;
    }
  );

  if (patched !== original) fs.writeFileSync(filePath, patched, "utf8");
}

if (!fs.existsSync(distDir)) {
  console.log("[fix-esm-imports] dist/ not found, skipping");
  process.exit(0);
}

const files = walk(distDir);
for (const f of files) patchFile(f);

console.log(`[fix-esm-imports] patched ${files.length} files`);
