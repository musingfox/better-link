import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const DOMAINS = [
  "fixupx.com",
  "tnktok.com",
  "bskx.app",
  "vxreddit.com",
  "phixiv.net",
  "fixthreads.seria.moe",
];

const TABLE_FILE = "fix-services.ts";

function violations(files: Record<string, string>, tableFile: string): string[] {
  const found: string[] = [];
  const table = files[tableFile]?.toLowerCase() ?? "";
  const others = Object.keys(files)
    .filter((path) => path !== tableFile)
    .sort();
  for (const domain of DOMAINS) {
    if (!table.includes(domain)) found.push(`${domain} missing from ${tableFile}`);
    for (const path of others) {
      if (files[path]?.toLowerCase().includes(domain)) found.push(`${domain} in ${path}`);
    }
  }
  return found;
}

async function srcTree(): Promise<Record<string, string>> {
  const root = new URL("../src/", import.meta.url);
  const files: Record<string, string> = {};
  for await (const file of new Bun.Glob("**/*").scan({ cwd: fileURLToPath(root.href) })) {
    files[file] = await Bun.file(new URL(file, root)).text();
  }
  return files;
}

const allSix = DOMAINS.join("\n");

function missingAll(tableFile: string): string[] {
  return DOMAINS.map((domain) => `${domain} missing from ${tableFile}`);
}

test("each fix-service domain appears only in the table file", async () => {
  expect(violations(await srcTree(), TABLE_FILE)).toEqual([]);
});

test("a domain copied into another source file is a violation", () => {
  expect(
    violations(
      {
        [TABLE_FILE]: allSix,
        "index.ts": 'const d = "fixupx.com";',
      },
      TABLE_FILE,
    ),
  ).toEqual(["fixupx.com in index.ts"]);
});

test("a domain absent from the table file is a violation", () => {
  expect(
    violations(
      {
        [TABLE_FILE]: DOMAINS.filter((domain) => domain !== "phixiv.net").join("\n"),
      },
      TABLE_FILE,
    ),
  ).toEqual(["phixiv.net missing from fix-services.ts"]);
});

test("domain matching ignores case", () => {
  expect(
    violations(
      {
        [TABLE_FILE]: allSix,
        "index.ts": "FIXUPX.COM",
      },
      TABLE_FILE,
    ),
  ).toEqual(["fixupx.com in index.ts"]);
});

test("a dot in a domain is a literal character", () => {
  expect(
    violations(
      {
        [TABLE_FILE]: allSix,
        "index.ts": "fixupxXcom",
      },
      TABLE_FILE,
    ),
  ).toEqual([]);
});

test("an empty source tree reports every domain missing from the table file", () => {
  expect(violations({}, TABLE_FILE)).toEqual(missingAll(TABLE_FILE));
});

test("other source files without the table file still report every domain missing", () => {
  expect(
    violations(
      {
        "index.ts": "export {};",
        "clean.ts": "export {};",
      },
      TABLE_FILE,
    ),
  ).toEqual(missingAll(TABLE_FILE));
});

test("a table file that names none of the domains reports every domain missing", () => {
  expect(violations({ [TABLE_FILE]: "export {};" }, TABLE_FILE)).toEqual(missingAll(TABLE_FILE));
});
