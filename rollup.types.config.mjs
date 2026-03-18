import { dts } from "rollup-plugin-dts";

const input = {
  index: "src/index.ts",
  "search/index": "src/search/index.ts",
  "filter/index": "src/filter/index.ts",
  "sort/index": "src/sort/index.ts",
  "merge/index": "src/merge/index.ts",
};

export default {
  input,
  output: {
    dir: "dist",
    entryFileNames: "[name].d.ts",
    format: "es",
  },
  plugins: [dts({ tsconfig: "./tsconfig.json" })],
};
