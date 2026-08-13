// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Module } = require("node:module");
const test = require("node:test");

/**
 * @param {Partial<import("../src/main/legacy-user-data.js").LegacyUserDataDependencies>} overrides
 * @returns {import("../src/main/legacy-user-data.js").LegacyUserDataDependencies}
 */
function dependencies(overrides) {
  return {
    argv: ["electron", "."],
    existsSync: () => false,
    getAppDataPath: () => "C:\\Users\\tester\\AppData\\Roaming",
    setUserDataPath: () => {},
    joinPath: (...parts) => parts.join("/"),
    ...overrides
  };
}

test("legacy userData bootstrap은 기존 폴더가 있으면 그 경로를 선택한다", (context) => {
  const electronPath = require.resolve("electron");
  const bootstrapPath = require.resolve("../src/main/legacy-user-data.js");
  const previousElectronModule = require.cache[electronPath];
  const previousBootstrapModule = require.cache[bootstrapPath];
  const mockElectronModule = new Module(electronPath);
  mockElectronModule.filename = electronPath;
  mockElectronModule.loaded = true;
  mockElectronModule.exports = {
    app: {
      getPath: () => "/path-that-does-not-exist",
      setPath: () => {}
    }
  };

  context.after(() => {
    delete require.cache[bootstrapPath];
    if (previousBootstrapModule) require.cache[bootstrapPath] = previousBootstrapModule;
    if (previousElectronModule) require.cache[electronPath] = previousElectronModule;
    else delete require.cache[electronPath];
  });

  require.cache[electronPath] = mockElectronModule;
  delete require.cache[bootstrapPath];
  const { configureLegacyUserDataPath, LEGACY_USER_DATA_DIR_NAME } = require(bootstrapPath);
  /** @type {string[]} */
  const selectedPaths = [];
  const appDataPath = "C:/Users/tester/AppData/Roaming";

  configureLegacyUserDataPath(dependencies({
    existsSync: (candidate) => candidate === `${appDataPath}/${LEGACY_USER_DATA_DIR_NAME}`,
    getAppDataPath: () => appDataPath,
    setUserDataPath: (candidate) => selectedPaths.push(candidate)
  }));

  assert.deepEqual(selectedPaths, [`${appDataPath}/${LEGACY_USER_DATA_DIR_NAME}`]);
});

test("명시적 user-data-dir가 있으면 legacy 경로를 조회하거나 덮어쓰지 않는다", () => {
  for (const argument of ["--user-data-dir", "--user-data-dir=C:/temporary-profile"]) {
    let dependencyCallCount = 0;
    const countCall = () => {
      dependencyCallCount += 1;
      return "unused";
    };

    const { configureLegacyUserDataPath } = require("../src/main/legacy-user-data.js");
    configureLegacyUserDataPath(dependencies({
      argv: ["electron", ".", argument],
      existsSync: () => {
        dependencyCallCount += 1;
        return true;
      },
      getAppDataPath: countCall,
      setUserDataPath: () => {
        dependencyCallCount += 1;
      }
    }));

    assert.equal(dependencyCallCount, 0, argument);
  }
});

test("legacy 폴더가 없거나 경로 의존성이 실패하면 Electron 기본 경로를 유지한다", () => {
  const { configureLegacyUserDataPath } = require("../src/main/legacy-user-data.js");
  let setPathCallCount = 0;
  configureLegacyUserDataPath(dependencies({
    setUserDataPath: () => {
      setPathCallCount += 1;
    }
  }));
  configureLegacyUserDataPath(dependencies({
    getAppDataPath: () => {
      throw new Error("appData path unavailable");
    },
    setUserDataPath: () => {
      setPathCallCount += 1;
    }
  }));

  assert.equal(setPathCallCount, 0);
});

test("main emit은 legacy userData bootstrap을 다른 모든 main 모듈보다 먼저 평가한다", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const moduleRequires = Array.from(
    mainSource.matchAll(/require\("([^"\n]+)"\)/g),
    (match) => match[1]
  );
  const mainModuleRequires = moduleRequires.filter((modulePath) => modulePath.startsWith("./main/"));

  assert.equal(moduleRequires[0], "./main/legacy-user-data.js");
  assert.ok(mainModuleRequires.length > 1);
  assert.equal(mainModuleRequires[0], "./main/legacy-user-data.js");
  assert.equal(
    mainModuleRequires.filter((modulePath) => modulePath === "./main/legacy-user-data.js").length,
    1
  );
});
