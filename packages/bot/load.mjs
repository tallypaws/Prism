import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as nodeResolve, dirname } from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";

const distDir = nodeResolve(process.cwd(), "dist");

let aliasMap = [];
try {
  const tsconfig = JSON.parse(readFileSync("./tsconfig.json", "utf8"));
  const baseUrl = tsconfig.compilerOptions?.baseUrl || ".";
  const paths = tsconfig.compilerOptions?.paths || {};
  aliasMap = Object.entries(paths).map(([alias, targets]) => {
    const key = alias.replace(/\*$/, "");
    const target = nodeResolve(baseUrl, targets[0].replace(/\*$/, ""));
    return [key, target];
  });
} catch (e) {
  console.warn("[resolve-loader] could not parse tsconfig.json:", e.message);
}

const extCandidates = [
  ".js",
  ".mjs",
  ".cjs",
  "/index.js",
  "/index.mjs",
  "/index.cjs",
];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    for (const [alias, targetDir] of aliasMap) {
      if (specifier.startsWith(alias)) {
        const subPath = specifier.slice(alias.length);
        const abs = nodeResolve(targetDir, subPath);
        for (const ext of [".js", ".mjs", ".cjs", "/index.js"]) {
          const candidate = abs + ext;
          try {
            await fs.access(candidate);
            return nextResolve(pathToFileURL(candidate).href, context);
          } catch {}
        }
      }
    }

    if (specifier.startsWith(".")) {
      const base = dirname(fileURLToPath(context.parentURL));
      const tryPath = nodeResolve(base, specifier);
      const relExts = ["", ...extCandidates];
      for (const ext of relExts) {
        const candidate = tryPath + ext;
        try {
          await fs.access(candidate);
          return nextResolve(pathToFileURL(candidate).href, context);
        } catch {}
      }
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      const tryPath = nodeResolve(distDir, specifier);

      const distExts = [
        ".js",
        "/index.js",
        ".mjs",
        ".cjs",
        "/index.mjs",
        "/index.cjs",
      ];
      for (const ext of distExts) {
        const candidate = tryPath + ext;
        try {
          await fs.access(candidate);
          return nextResolve(pathToFileURL(candidate).href, context);
        } catch {}
      }
    }

    throw err;
  }
}
