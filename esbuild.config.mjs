import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import process from "process";

const isProduction = process.argv[2] === "production";
// Vault the plugin is copied into on every build. Set at user level, e.g. in
// ~/.zshrc: export OBSIDIAN_VAULT="/path/to/vault"
// Unset or empty = repo-local copy only (no default path in code).
const vaultDir = (process.env.OBSIDIAN_VAULT || "").trim();
const extraVaultPluginDirs = (process.env.OBSIDIAN_PLUGIN_DIR || "")
  .split(":")
  .map(p => p.trim())
  .filter(Boolean);

const sharedConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: "main.js",
  sourcemap: isProduction ? false : "inline",
  sourcesContent: false,
  treeShaking: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": isProduction ? '"production"' : '"development"'
  }
};

async function buildPlugin() {
  try {
    await build({
      ...sharedConfig,
      minify: isProduction
    });
    console.log(`Build ${isProduction ? "production" : "development"} complete`);

    if (existsSync("manifest.json")) {
      const pluginDirs = [
        join(process.cwd(), ".obsidian", "plugins", "obsidian-opds"),
        ...(vaultDir ? [join(vaultDir, ".obsidian", "plugins", "obsidian-opds")] : []),
        ...extraVaultPluginDirs
      ];
      for (const pluginDir of pluginDirs) {
        if (!existsSync(pluginDir)) {
          mkdirSync(pluginDir, { recursive: true });
        }
        copyFileSync("manifest.json", join(pluginDir, "manifest.json"));
        copyFileSync("main.js", join(pluginDir, "main.js"));
        if (existsSync("main.js.map")) {
          copyFileSync("main.js.map", join(pluginDir, "main.js.map"));
        }
        // Obsidian loads styles.css beside main.js; do not bundle CSS into JS.
        if (existsSync("src/styles.css")) {
          copyFileSync("src/styles.css", join(pluginDir, "styles.css"));
        }
      }
      console.log(
        "Plugin copied to local .obsidian/plugins/obsidian-opds" +
        (vaultDir ? ` and ${vaultDir}` : " (vault copy skipped)") +
        (extraVaultPluginDirs.length ? " and OBSIDIAN_PLUGIN_DIR targets" : "")
      );
    }
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

buildPlugin();