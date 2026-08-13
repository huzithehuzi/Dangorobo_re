// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createFavoriteIconService } = require("../src/main/windows/favorite-icon-service.js");

/**
 * @param {string} dataUrl
 * @param {boolean} [empty]
 */
function fakeNativeImage(dataUrl, empty = false) {
  return {
    isEmpty: () => empty,
    toDataURL: () => dataUrl
  };
}

/**
 * @param {Partial<import("../src/main/windows/favorite-icon-service.js").FavoriteIconServiceDeps>} [overrides]
 */
function makeService(overrides = {}) {
  /** @type {import("../src/main/windows/favorite-icon-service.js").FavoriteIconServiceDeps} */
  const deps = {
    platform: "win32",
    powershellPath: () => "powershell.exe",
    execFile: (_file, _args, _options, callback) => callback(new Error("추출 실패"), ""),
    readShortcutLink: () => ({}),
    getFileIcon: async () => fakeNativeImage("", true),
    ...overrides
  };
  return createFavoriteIconService(deps);
}

/**
 * @param {import("node:test").TestContext} context
 */
function makeTempDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-favorite-icons-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * @param {string} directory
 * @param {string} name
 * @param {string} [contents]
 */
function writeFixture(directory, name, contents = "icon-bytes") {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test("커스텀 이미지 확장자에 맞는 MIME과 원본 바이트를 사용한다", async (context) => {
  const directory = makeTempDirectory(context);
  const service = makeService();
  const encoded = Buffer.from("icon-bytes").toString("base64");
  const cases = [
    ["icon.png", "image/png"],
    ["icon.jpg", "image/jpeg"],
    ["icon.jpeg", "image/jpeg"],
    ["icon.bmp", "image/bmp"],
    ["icon.webp", "image/webp"],
    ["icon.unknown", "image/png"]
  ];

  for (const [name, mime] of cases) {
    const filePath = writeFixture(directory, name);
    assert.equal(await service.customIconDataUrl(filePath), `data:${mime};base64,${encoded}`);
  }
  assert.equal(await service.customIconDataUrl(path.join(directory, "missing.png")), null);
});

test("ico는 PowerShell 추출을 먼저 쓰고 실패하면 원본 파일로 폴백한다", async (context) => {
  const directory = makeTempDirectory(context);
  const iconPath = writeFixture(directory, "custom.ico", "raw-ico");
  let seenExecutable = "";
  let seenCommand = "";
  let seenPath = "";
  let seenIndex = "";
  const extractedService = makeService({
    powershellPath: () => "custom-powershell.exe",
    execFile: (file, args, options, callback) => {
      seenExecutable = file;
      seenCommand = args.join(" ");
      seenPath = String(options.env.RB_ICON_PATH);
      seenIndex = String(options.env.RB_ICON_INDEX);
      callback(null, "  EXTRACTED_ICO\r\n");
    }
  });

  assert.equal(
    await extractedService.customIconDataUrl(iconPath),
    "data:image/png;base64,EXTRACTED_ICO"
  );
  assert.equal(seenExecutable, "custom-powershell.exe");
  assert.ok(seenCommand.includes("ExtractIconEx"));
  assert.equal(seenPath, iconPath);
  assert.equal(seenIndex, "0");

  const fallbackService = makeService();
  assert.equal(
    await fallbackService.customIconDataUrl(iconPath),
    `data:image/x-icon;base64,${Buffer.from("raw-ico").toString("base64")}`
  );
});

test("Windows가 아니면 ico PowerShell 추출을 건너뛰고 원본을 사용한다", async (context) => {
  const directory = makeTempDirectory(context);
  const iconPath = writeFixture(directory, "custom.ico", "raw-ico");
  let executions = 0;
  const service = makeService({
    platform: "darwin",
    execFile: (_file, _args, _options, callback) => {
      executions += 1;
      callback(null, "SHOULD_NOT_RUN");
    }
  });

  assert.equal(
    await service.customIconDataUrl(iconPath),
    `data:image/x-icon;base64,${Buffer.from("raw-ico").toString("base64")}`
  );
  assert.equal(executions, 0);
});

test("url 바로가기는 IconFile과 IconIndex를 PowerShell에 전달한다", async (context) => {
  const directory = makeTempDirectory(context);
  const iconPath = writeFixture(directory, "site.ico");
  const shortcutPath = writeFixture(
    directory,
    "site.url",
    `[InternetShortcut]\nURL=https://example.com\nIconFile=  ${iconPath}  \nIconIndex=7\n`
  );
  let seenPath = "";
  let seenIndex = "";
  let fileIconCalls = 0;
  const service = makeService({
    execFile: (_file, _args, options, callback) => {
      seenPath = String(options.env.RB_ICON_PATH);
      seenIndex = String(options.env.RB_ICON_INDEX);
      callback(null, "URL_ICON");
    },
    getFileIcon: async () => {
      fileIconCalls += 1;
      return fakeNativeImage("data:image/png;base64,FALLBACK");
    }
  });

  assert.equal(await service.autoIconDataUrl(shortcutPath), "data:image/png;base64,URL_ICON");
  assert.equal(seenPath, iconPath);
  assert.equal(seenIndex, "7");
  assert.equal(fileIconCalls, 0, ".url은 셸 아이콘으로 폴백하지 않는다");
});

test("lnk는 지정 아이콘, 실제 대상, lnk 자체 순서로 폴백한다", async () => {
  /** @type {string[]} */
  const calls = [];
  const service = makeService({
    readShortcutLink: () => ({ icon: "launcher.dll", iconIndex: 4, target: "application.exe" }),
    execFile: (_file, _args, options, callback) => {
      calls.push(`extract:${options.env.RB_ICON_PATH}:${options.env.RB_ICON_INDEX}`);
      callback(new Error("아이콘 없음"), "");
    },
    getFileIcon: async (target) => {
      calls.push(`file:${target}`);
      if (target === "application.exe") return fakeNativeImage("", true);
      return fakeNativeImage("data:image/png;base64,LNK_FALLBACK");
    }
  });

  assert.equal(await service.autoIconDataUrl("shortcut.lnk"), "data:image/png;base64,LNK_FALLBACK");
  assert.deepEqual(calls, [
    "extract:launcher.dll:4",
    "file:application.exe",
    "file:shortcut.lnk"
  ]);
});

test("lnk의 지정 아이콘 추출이 성공하면 뒤 폴백은 호출하지 않는다", async () => {
  let fileIconCalls = 0;
  const service = makeService({
    readShortcutLink: () => ({ icon: "launcher.dll", iconIndex: 2, target: "application.exe" }),
    execFile: (_file, _args, _options, callback) => callback(null, "LNK_ICON"),
    getFileIcon: async () => {
      fileIconCalls += 1;
      return fakeNativeImage("data:image/png;base64,FALLBACK");
    }
  });

  assert.equal(await service.autoIconDataUrl("shortcut.lnk"), "data:image/png;base64,LNK_ICON");
  assert.equal(fileIconCalls, 0);
});

test("자동 아이콘은 null 결과까지 캐시하고 clearCache 뒤 다시 조회한다", async () => {
  let fileIconCalls = 0;
  const service = makeService({
    getFileIcon: async () => {
      fileIconCalls += 1;
      return fakeNativeImage("", true);
    }
  });

  assert.equal(await service.autoIconDataUrl("missing.exe"), null);
  assert.equal(await service.autoIconDataUrl("missing.exe"), null);
  assert.equal(fileIconCalls, 1);
  service.clearCache();
  assert.equal(await service.autoIconDataUrl("missing.exe"), null);
  assert.equal(fileIconCalls, 2);
});

test("launch items는 custom을 우선하고 template과 custom에서 자동 추출을 건너뛴다", async (context) => {
  const directory = makeTempDirectory(context);
  const customPath = writeFixture(directory, "custom.png", "custom");
  let fileIconCalls = 0;
  const service = makeService({
    getFileIcon: async (target) => {
      fileIconCalls += 1;
      return fakeNativeImage(`data:image/png;base64,AUTO:${target}`);
    }
  });

  const items = await service.buildLaunchItems([
    { id: "custom", name: "커스텀", target: "custom-target.exe", customIcon: customPath, iconTemplate: "heart", iconColor: "#111111" },
    { id: "missing-custom", name: "없는 커스텀", target: "missing-target.exe", customIcon: path.join(directory, "missing.png"), iconTemplate: "star", iconColor: "#222222" },
    { id: "template", name: "템플릿", target: "template-target.exe", iconTemplate: "folder", iconColor: "#abcdef" },
    { id: "auto", name: "자동", target: "auto-target.exe", iconTemplate: "", iconColor: "#ffffff", customIcon: "" }
  ]);

  assert.deepEqual(items, [
    {
      id: "custom",
      name: "커스텀",
      icon: `data:image/png;base64,${Buffer.from("custom").toString("base64")}`,
      iconTemplate: null,
      iconColor: null
    },
    { id: "missing-custom", name: "없는 커스텀", icon: null, iconTemplate: null, iconColor: null },
    { id: "template", name: "템플릿", icon: null, iconTemplate: "folder", iconColor: "#abcdef" },
    {
      id: "auto",
      name: "자동",
      icon: "data:image/png;base64,AUTO:auto-target.exe",
      iconTemplate: null,
      iconColor: null
    }
  ]);
  assert.equal(fileIconCalls, 1, "자동 모드인 항목만 셸 아이콘을 조회한다");
});

test("menu hydration은 중첩 항목까지 채우고 template 항목을 건너뛴다", async (context) => {
  const directory = makeTempDirectory(context);
  const customPath = writeFixture(directory, "custom.png", "custom");
  /** @type {string[]} */
  const fileIconTargets = [];
  const service = makeService({
    getFileIcon: async (target) => {
      fileIconTargets.push(target);
      return fakeNativeImage(`data:image/png;base64,AUTO:${target}`);
    }
  });
  const items = [
    { target: "ignored.exe", customIcon: customPath, iconTemplate: "heart", iconDataUrl: null },
    { target: "template.exe", iconTemplate: "folder", iconDataUrl: null },
    {
      items: [
        { target: "nested.exe", iconDataUrl: null },
        { target: "nested-template.exe", iconTemplate: "star", iconDataUrl: null }
      ]
    }
  ];

  const hydrated = await service.hydrateMenuItems(items);
  assert.equal(hydrated, items, "호출부가 가진 같은 배열을 수정해 반환한다");
  assert.equal(items[0].iconDataUrl, `data:image/png;base64,${Buffer.from("custom").toString("base64")}`);
  assert.equal(items[1].iconDataUrl, null);
  assert.equal(items[2].items?.[0].iconDataUrl, "data:image/png;base64,AUTO:nested.exe");
  assert.equal(items[2].items?.[1].iconDataUrl, null);
  assert.deepEqual(fileIconTargets, ["nested.exe"]);
});
