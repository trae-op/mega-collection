import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PACKAGE_DIR = path.join(ROOT_DIR, "package");
const ROOT_PACKAGE_PATH = path.join(ROOT_DIR, "package.json");
const ROOT_README_PATH = path.join(ROOT_DIR, "README.md");

const PACKAGE_EXPORTS = {
  ".": {
    types: "./dist/index.d.mts",
    default: "./dist/index.mjs",
  },
  "./search": {
    types: "./dist/search/index.d.mts",
    default: "./dist/search/index.mjs",
  },
  "./filter": {
    types: "./dist/filter/index.d.mts",
    default: "./dist/filter/index.mjs",
  },
  "./sort": {
    types: "./dist/sort/index.d.mts",
    default: "./dist/sort/index.mjs",
  },
  "./merge": {
    types: "./dist/merge/index.d.mts",
    default: "./dist/merge/index.mjs",
  },
  "./package.json": "./package.json",
};

const PACKAGE_TYPES_VERSIONS = {
  "*": {
    search: ["./dist/search/index.d.mts"],
    filter: ["./dist/filter/index.d.mts"],
    sort: ["./dist/sort/index.d.mts"],
    merge: ["./dist/merge/index.d.mts"],
  },
};

async function readRootPackage() {
  const packageJson = await readFile(ROOT_PACKAGE_PATH, "utf8");
  return JSON.parse(packageJson);
}

async function readRootReadme() {
  return readFile(ROOT_README_PATH, "utf8");
}

function createPublishReadme(rootReadme, repositoryUrl) {
  let publishReadme = rootReadme.replace(
    /^<p align="center">[\s\S]*?<\/p>\n\n/,
    "",
  );

  if (!repositoryUrl) {
    return publishReadme;
  }

  const readmeLinks = {
    "CONTRIBUTING.md": `${repositoryUrl}/blob/main/CONTRIBUTING.md`,
    "SECURITY.md": `${repositoryUrl}/blob/main/SECURITY.md`,
    LICENSE: `${repositoryUrl}/blob/main/LICENSE`,
  };

  for (const [relativePath, absoluteUrl] of Object.entries(readmeLinks)) {
    publishReadme = publishReadme.replaceAll(
      `](${relativePath})`,
      `](${absoluteUrl})`,
    );
  }

  return publishReadme;
}

function createPublishPackage(rootPackage) {
  const repositoryUrl = rootPackage.repository?.url
    ?.replace(/^git\+/, "")
    .replace(/\.git$/, "");

  return {
    name: rootPackage.name,
    version: rootPackage.version,
    license: rootPackage.license,
    sideEffects: rootPackage.sideEffects ?? false,
    types: "./dist/index.d.mts",
    exports: PACKAGE_EXPORTS,
    typesVersions: PACKAGE_TYPES_VERSIONS,
    repository: repositoryUrl
      ? {
          type: "git",
          url: repositoryUrl,
        }
      : undefined,
  };
}

async function preparePackage() {
  const rootPackage = await readRootPackage();
  const rootReadme = await readRootReadme();
  const publishPackage = createPublishPackage(rootPackage);
  const repositoryUrl = publishPackage.repository?.url;
  const publishReadme = createPublishReadme(rootReadme, repositoryUrl);

  await rm(PACKAGE_DIR, { recursive: true, force: true });
  await mkdir(PACKAGE_DIR, { recursive: true });

  await cp(DIST_DIR, path.join(PACKAGE_DIR, "dist"), { recursive: true });
  await writeFile(
    path.join(PACKAGE_DIR, "package.json"),
    `${JSON.stringify(publishPackage)}\n`,
  );
  await writeFile(path.join(PACKAGE_DIR, "README.md"), publishReadme);
}

preparePackage().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
