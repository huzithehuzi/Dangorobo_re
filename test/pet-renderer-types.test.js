"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const rendererPath = path.join(projectRoot, "src", "pet", "renderer.ts");

/** @param {string} name */
function dependencyVersion(name) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const version = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name] || "";
  const match = String(version).match(/(\d+)\.(\d+)/);
  assert.ok(match, `${name} 버전에서 major/minor를 읽을 수 있어야 한다`);
  return `${match[1]}.${match[2]}`;
}

function preloadMethodNames() {
  const source = fs.readFileSync(path.join(projectRoot, "src", "preload.ts"), "utf8");
  return new Set([...source.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]));
}

function declaredPetDesktopMethods() {
  const source = fs.readFileSync(path.join(projectRoot, "types", "pet-globals.d.ts"), "utf8");
  const start = source.indexOf("interface PetDesktopApi {");
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, "PetDesktopApi 선언을 읽을 수 있어야 한다");
  const declaration = source.slice(start, end);
  return new Set([...declaration.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\(/gm)].map((match) => match[1]));
}

// 펫 창은 renderer.ts 하나가 아니라 src/pet의 여러 모듈로 나뉘어 있으므로 전부 훑는다.
// 한 파일만 보면 다른 모듈로 옮겨간 호출이 "선언만 있고 안 쓰는 메서드"로 잘못 잡힌다.
function rendererDesktopMethods() {
  const petDir = path.join(projectRoot, "src", "pet");
  const sources = fs.readdirSync(petDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(petDir, name), "utf8"))
    .join("\n");
  return new Set([...sources.matchAll(/window\.desktopPet\.([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]));
}

/**
 * @param {string} source
 * @param {string} relativePath
 */
function stripVendoredHeader(source, relativePath) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  assert.equal(lines[0], "// @ts-nocheck", `${relativePath}의 로컬 타입 검사 헤더가 바뀌었다`);
  assert.match(lines[1] || "", /vendored 코드/, `${relativePath}의 vendored 안내 헤더가 없다`);
  assert.match(lines[2] || "", /tsconfig/, `${relativePath}의 tsconfig 안내 헤더가 없다`);
  return lines.slice(3).join("\n");
}

test("Three 런타임과 공식 타입 선언의 major/minor가 일치한다", () => {
  assert.equal(dependencyVersion("three"), dependencyVersion("@types/three"));
  assert.equal(fs.existsSync(path.join(projectRoot, "types", "three.d.ts")), false);

  const loaderDeclaration = fs.readFileSync(
    path.join(projectRoot, "src", "vendor", "three", "loaders", "GLTFLoader.d.ts"),
    "utf8"
  );
  assert.match(loaderDeclaration, /three\/examples\/jsm\/loaders\/GLTFLoader\.js/);
});

const threeJsmDir = path.join(projectRoot, "node_modules", "three", "examples", "jsm");
const threeVendorDir = path.join(projectRoot, "src", "vendor", "three");

// GLTFLoader에서 시작해 상대 import를 따라간 폐포. 사본 목록을 손으로 적으면 upstream이 새
// 상대 import를 추가했을 때 검사 없이 통과하고, 펫 창만 모듈 로드에 통째로 실패한다
// (three 0.185가 GLTFLoader에 SkeletonUtils import를 추가했을 때 실제로 겪었다).
function vendoredModuleClosure() {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = ["loaders/GLTFLoader.js"];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (seen.has(current)) continue;
    seen.add(current);
    const source = fs.readFileSync(path.join(threeJsmDir, current), "utf8");
    for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      queue.push(path.posix.join(path.posix.dirname(current), match[1]));
    }
  }
  return [...seen].sort();
}

/** @param {string} directory @returns {string[]} */
function vendoredJsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return vendoredJsFiles(child);
    if (!entry.name.endsWith(".js")) return [];
    return [path.relative(threeVendorDir, child).split(path.sep).join("/")];
  });
}

test("배포용 Three 보조 모듈은 상대 import 폐포를 모두 사본으로 두고 공식 구현과 일치한다", () => {
  const modules = vendoredModuleClosure();
  assert.ok(modules.includes("loaders/GLTFLoader.js"));

  for (const relativePath of modules) {
    const vendoredPath = path.join(threeVendorDir, ...relativePath.split("/"));
    assert.ok(
      fs.existsSync(vendoredPath),
      `${relativePath} 사본이 없다 — 이게 빠지면 펫 창만 모듈 로드에 실패한다`
    );
    const upstreamSource = fs
      .readFileSync(path.join(threeJsmDir, relativePath), "utf8")
      .replace(/\r\n?/g, "\n");

    assert.equal(
      stripVendoredHeader(fs.readFileSync(vendoredPath, "utf8"), relativePath),
      upstreamSource,
      `${relativePath}가 설치된 three의 공식 구현과 다르다`
    );
  }

  // 폐포에 없는 사본이 남아 있으면 배포 용량만 늘고 Three를 올릴 때 갱신에서 빠진다.
  assert.deepEqual(vendoredJsFiles(threeVendorDir).sort(), modules);
});

test("펫 렌더러와 브라우저 전역 계약에 broad any나 타입 억제가 없다", () => {
  const sources = [rendererPath, path.join(projectRoot, "types", "pet-globals.d.ts")];

  for (const sourcePath of sources) {
    const source = fs.readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /\bany\b/, `${path.relative(projectRoot, sourcePath)}에 broad any가 남아 있다`);
    assert.doesNotMatch(
      source,
      /@ts-(?:ignore|expect-error|nocheck)|eslint-disable/,
      `${path.relative(projectRoot, sourcePath)}에 타입 검사를 우회하는 지시문이 남아 있다`
    );
  }
});

test("펫 창 모듈은 strict 검사와 브라우저 ESM 제자리 emit 설정을 사용한다", () => {
  const checkConfig = fs.readFileSync(path.join(projectRoot, "src", "pet", "tsconfig.json"), "utf8");
  const buildConfig = fs.readFileSync(
    path.join(projectRoot, "src", "pet", "tsconfig.build.json"),
    "utf8"
  );

  assert.match(checkConfig, /"module"\s*:\s*"ESNext"/);
  assert.match(checkConfig, /"moduleResolution"\s*:\s*"Bundler"/);
  assert.match(checkConfig, /"strict"\s*:\s*true/);
  assert.match(checkConfig, /"noEmit"\s*:\s*true/);
  // src/pet의 .ts 전부가 검사·emit 대상이다(renderer 하나였던 시절의 단일 파일 계약이 아니다).
  assert.match(checkConfig, /"include"\s*:\s*\["\.\/\*\.ts",\s*"\.\.\/\.\.\/types\/\*\*\/\*\.d\.ts"\]/);
  assert.match(checkConfig, /"exclude"\s*:\s*\["\.\/\*\.js"\]/);

  assert.match(buildConfig, /"extends"\s*:\s*"\.\/tsconfig\.json"/);
  assert.match(buildConfig, /"noEmit"\s*:\s*false/);
  assert.match(buildConfig, /"noEmitOnError"\s*:\s*true/);
  assert.match(buildConfig, /"noCheck"\s*:\s*true/);
  assert.match(buildConfig, /"noResolve"\s*:\s*true/);
  assert.match(buildConfig, /"include"\s*:\s*\["\.\/\*\.ts"\]/);
  assert.match(buildConfig, /"exclude"\s*:\s*\["\.\/\*\.js"\]/);
});

test("펫 창은 생성된 renderer.js를 브라우저 ESM으로 로드한다", () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, "src", "pet", "index.html"), "utf8");
  const gitignore = fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
  const eslintConfig = fs.readFileSync(path.join(projectRoot, "eslint.config.js"), "utf8");
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );
  const petPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "src", "pet", "package.json"), "utf8")
  );

  assert.equal(petPackage.type, "module");
  assert.match(indexHtml, /<script type="module" src="\.\/renderer\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /renderer\.ts/);
  // 펫 모듈이 여러 개가 됐으므로 산출물 제외도 renderer 하나가 아니라 src/pet의 .js 전체다.
  assert.match(gitignore, /^\/src\/pet\/\*\.js$/m);
  assert.match(eslintConfig, /"src\/pet\/\*\.js"/);
  assert.ok(rootPackage.build.files.includes("src/**/*"));
  assert.ok(rootPackage.build.files.includes("!src/**/*.ts"));
});

// emit 단계가 noResolve라 상대 import는 해석되지 않고 그대로 브라우저로 나간다. 검사 단계는
// moduleResolution이 Bundler라서 확장자를 빼도 통과하는데, 그러면 타입 검사·빌드는 멀쩡히
// 끝나고 펫 창만 로드에 실패한다. 확장자를 강제해 그 조합을 막는다.
test("펫 모듈끼리의 상대 import는 브라우저가 읽을 수 있게 .js 확장자를 붙인다", () => {
  const petDir = path.join(projectRoot, "src", "pet");
  const sources = fs.readdirSync(petDir).filter((name) => name.endsWith(".ts"));
  assert.ok(sources.includes("renderer.ts"));

  for (const name of sources) {
    const source = fs.readFileSync(path.join(petDir, name), "utf8");
    const specifiers = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]);
    const relative = specifiers.filter((specifier) => specifier.startsWith("."));
    for (const specifier of relative) {
      assert.ok(
        specifier.endsWith(".js"),
        `src/pet/${name}의 상대 import "${specifier}"에 .js 확장자가 없다`
      );
    }
  }
});

test("펫이 쓰는 preload 메서드는 전역 선언 및 실제 contextBridge 공개 API와 일치한다", () => {
  const exposed = preloadMethodNames();
  const declared = declaredPetDesktopMethods();
  const used = rendererDesktopMethods();

  assert.deepEqual([...declared].sort(), [...used].sort());
  for (const method of declared) {
    assert.ok(exposed.has(method), `${method}는 PetDesktopApi에만 있고 실제 preload에는 없다`);
  }
});
