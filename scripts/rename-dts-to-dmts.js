const { readdir, rename, unlink } = require("fs/promises");
const { join } = require("path");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }

    if (entry.name.endsWith(".d.ts")) {
      const dest = full.slice(0, -".d.ts".length) + ".d.mts";
      await rename(full, dest);
      continue;
    }

    if (entry.name.endsWith(".d.ts.map")) {
      await unlink(full);
      continue;
    }
  }
}

(async () => {
  try {
    await walk("./dist");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
