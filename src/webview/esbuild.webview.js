/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require("node:process");
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

esbuild
  .context({
    entryPoints: ["src/webview/index.tsx"],
    bundle: true,
    outdir: "out",
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    loader: {
      ".html": "copy",
      ".css": "css",
      ".tsx": "tsx",
      ".ts": "ts",
    },
    minify: process.env.NODE_ENV === "production",
  })
  .then(async (ctx) => {
    if (watch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  });
