import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: true,
    sourcemap: false,
    lib: {
      entry: {
        index: "src/index.ts",
        "search/index": "src/search/index.ts",
        "filter/index": "src/filter/index.ts",
        "sort/index": "src/sort/index.ts",
        "merge/index": "src/merge/index.ts",
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      output: {
        chunkFileNames: "chunk-[hash].mjs",
      },
    },
  },
});
