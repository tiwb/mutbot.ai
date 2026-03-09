/**
 * Vite plugin: serve local mutbot frontend build in dev mode.
 *
 * Reads `.dev.json` at project root:
 *   { "localBuild": "D:/ai/mutbot/src/mutbot/web/frontend_dist", "version": "0.5.999" }
 *
 * 1. Serves `/v{version}/*` from the localBuild directory.
 * 2. Intercepts `/versions.json` and injects a dev entry (parsed from localBuild/index.html).
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Parse js/css entry filenames from index.html */
function parseEntry(indexHtml) {
  const js = indexHtml.match(/src="\.?\/?(.+?\.js)"/)?.[1] || "";
  const css = indexHtml.match(/href="\.?\/?(.+?\.css)"/)?.[1] || "";
  return { js, css };
}

export default function devLocal() {
  const cfgPath = path.resolve(".dev.json");
  if (!existsSync(cfgPath)) return { name: "vite-dev-local" };

  let config;
  try {
    config = JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return { name: "vite-dev-local" };
  }

  const { localBuild, version } = config;
  if (!localBuild || !version) return { name: "vite-dev-local" };

  const buildDir = path.resolve(localBuild);
  if (!existsSync(buildDir)) {
    console.warn(`[vite-dev-local] localBuild directory not found: ${buildDir}`);
    return { name: "vite-dev-local" };
  }

  const prefix = `/v${version}/`;

  return {
    name: "vite-dev-local",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Serve local build files at /v{version}/*
        if (req.url?.startsWith(prefix)) {
          const relPath = req.url.slice(prefix.length);
          const filePath = path.join(buildDir, relPath);
          if (existsSync(filePath)) {
            const ext = path.extname(filePath);
            const mimeTypes = {
              ".js": "application/javascript",
              ".css": "text/css",
              ".html": "text/html",
              ".json": "application/json",
              ".wasm": "application/wasm",
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".woff2": "font/woff2",
            };
            res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
            res.end(readFileSync(filePath));
            return;
          }
        }

        // Intercept /versions.json and inject dev entry
        if (req.url === "/versions.json") {
          const publicJson = path.resolve("public/versions.json");
          if (!existsSync(publicJson)) return next();

          try {
            const data = JSON.parse(readFileSync(publicJson, "utf-8"));
            const indexPath = path.join(buildDir, "index.html");
            if (existsSync(indexPath)) {
              const entry = parseEntry(readFileSync(indexPath, "utf-8"));
              // Remove existing dev entry if any, then append
              data.versions = data.versions.filter((v) => v.version !== version);
              data.versions.push({ version, date: "dev", entry });
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data, null, 2));
            return;
          } catch {
            return next();
          }
        }

        next();
      });
    },
  };
}
