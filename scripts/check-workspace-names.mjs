import fs from "node:fs";
import path from "node:path";

const pkgs = [
  ["packages/core-domain", "@mini-sync/core-domain"],
  ["packages/core-application", "@mini-sync/core-application"],
  ["apps/desktop", "@mini-sync/desktop"],
];

let ok = true;

for (const [dir, expected] of pkgs) {
  const p = path.join(process.cwd(), dir, "package.json");
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  if (json.name !== expected) {
    ok = false;
    console.error(
      `[ERR] ${dir}/package.json name="${json.name}" (expected "${expected}")`
    );
  } else {
    console.log(`[OK]  ${dir} -> ${json.name}`);
  }
}

process.exit(ok ? 0 : 1);
