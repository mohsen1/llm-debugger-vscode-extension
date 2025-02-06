/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require("node:process");
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

esbuild
  .context({
    entryPoints: ["src/index.ts"], // or whatever your extension entry is
    bundle: true,
    outdir: "out",
    // output CJS
    format: "cjs",
    platform: "node",
    target: "es2020",
    sourcemap: true,
    external: ["vscode", "src/webview/"],
  })
  .then(async (ctx) => {
    if (watch) {
      console.log("Watching for changes");
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  });
