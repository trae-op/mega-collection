import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "search/index": "src/search/index.ts",
    "filter/index": "src/filter/index.ts",
    "sort/index": "src/sort/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  clean: true,
  target: "es2020",
  sourcemap: true,
  treeshake: true,
  outDir: "dist",
});
