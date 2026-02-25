import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "search/index": "src/search/index.ts",
    "filter/index": "src/filter/index.ts",
    "sort/index": "src/sort/index.ts",
    "merge/index": "src/merge/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  minify: true,
  clean: true,
  target: "es2020",
  sourcemap: false,
  treeshake: true,
  outDir: "dist",
});
