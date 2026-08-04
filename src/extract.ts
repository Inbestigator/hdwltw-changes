import { mkdirSync, writeFileSync } from "node:fs";
import type { LaunchOptions, PuppeteerNode } from "puppeteer";

interface AssetsMap {
  [varName: string]: string;
}

interface FilesMap {
  modern: Record<string, string>;
  retro: Record<string, string>;
  other: Record<string, string>;
}

interface DiffEntry {
  date: string;
  added: Record<string, string>;
  removed: Record<string, string>;
}

let cachedExecutablePath: string | null = null;
let downloadPromise: Promise<string> | null = null;

async function getChromiumPath(): Promise<string> {
  if (cachedExecutablePath) return cachedExecutablePath;
  if (!downloadPromise) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    downloadPromise = chromium
      .executablePath("https://puppeteer-on-vercel-example.vercel.app/chromium-pack.tar")
      .then((path) => {
        cachedExecutablePath = path;
        console.log("Chromium path resolved:", path);
        return path;
      })
      .catch((error) => {
        console.error("Failed to get Chromium path:", error);
        downloadPromise = null;
        throw error;
      });
  }
  return downloadPromise;
}

async function fetchRemoteJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`Error fetching ${url}:`, error);
    return null;
  }
}

function computeValueBasedDiff(
  oldObj: Record<string, string>,
  newObj: Record<string, string>,
): { added: Record<string, string>; removed: Record<string, string> } {
  const oldVals = new Set(Object.values(oldObj));
  const newVals = new Set(Object.values(newObj));

  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};

  for (const [newVar, path] of Object.entries(newObj)) {
    if (!oldVals.has(path)) {
      added[newVar] = path;
    }
  }

  for (const [oldVar, path] of Object.entries(oldObj)) {
    if (!newVals.has(path)) {
      removed[oldVar] = path;
    }
  }

  return { added, removed };
}

async function extractAllAssets(targetUrl: string) {
  console.log(`[1/5] Launching browser and fetching scripts from ${targetUrl}...`);
  let puppeteer: PuppeteerNode;
  let launchOptions: LaunchOptions = { headless: true };
  if (process.env.VERCEL_ENV) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    puppeteer = (await import("puppeteer-core")) as never;
    const executablePath = await getChromiumPath();
    launchOptions = { ...launchOptions, args: chromium.args, executablePath };
  } else {
    puppeteer = (await import("puppeteer")) as never;
  }
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  const scriptContents: { url: string; code: string }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const req = response.request();
    if (req.resourceType() === "script" || url.endsWith(".js")) {
      try {
        const code = await response.text();
        scriptContents.push({ url, code });
      } catch {}
    }
  });

  await page.goto(targetUrl, { waitUntil: "networkidle2" });
  await browser.close();

  console.log(
    `[2/5] Intercepted ${scriptContents.length} JavaScript files. Parsing across all files...`,
  );

  const assetsJson: AssetsMap = {};
  const filesJson: FilesMap = { modern: {}, retro: {}, other: {} };

  const varAssetRegex = /(?:const|let|var|,|\b)([a-zA-Z0-9_$]+)\s*=\s*["'](\/assets\/[^"']+)["']/g;
  for (const script of scriptContents) {
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: ignore
    while ((match = varAssetRegex.exec(script.code)) !== null) {
      const [, varName, assetPath] = match;
      if (!varName || !assetPath) continue;
      assetsJson[varName] = assetPath;
    }
  }

  console.log(
    `[3/5] Extracted ${Object.keys(assetsJson).length} variable mappings to assets.json.`,
  );

  const filePairRegex =
    /["'](\.?\/?assets\/files\/[^"']+|(?:\.\.\/)+assets\/[^"']+)["']\s*:\s*([a-zA-Z0-9_$]+|["']\/assets\/[^"']+["'])/g;
  for (const script of scriptContents) {
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: ignore
    while ((match = filePairRegex.exec(script.code)) !== null) {
      const [, filePath, rawValue] = match;
      if (!filePath || !rawValue) continue;
      let resolvedUrl: string | undefined;

      if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
        resolvedUrl = rawValue.slice(1, -1);
      } else if (assetsJson[rawValue]) {
        resolvedUrl = assetsJson[rawValue];
      }

      if (resolvedUrl) {
        if (filePath.includes("/modern/")) {
          filesJson.modern[filePath] ??= resolvedUrl;
        } else if (filePath.includes("/retro/")) {
          filesJson.retro[filePath] ??= resolvedUrl;
        } else {
          filesJson.other[filePath] ??= resolvedUrl;
        }
      }
    }
  }

  console.log(`[4/5] Fetching remote reference JSONs and existing history arrays...`);
  const [remoteAssets, remoteFiles, remoteAssetsDiffs, remoteFilesDiffs] = await Promise.all([
    fetchRemoteJson<AssetsMap>("https://hdwltw.vercel.app/assets.json"),
    fetchRemoteJson<FilesMap>("https://hdwltw.vercel.app/files.json"),
    fetchRemoteJson<DiffEntry[]>("https://hdwltw.vercel.app/diffs/assets.json"),
    fetchRemoteJson<DiffEntry[]>("https://hdwltw.vercel.app/diffs/files.json"),
  ]);

  const currentDate = new Date().toISOString();
  const assetsDiffHistory: DiffEntry[] = Array.isArray(remoteAssetsDiffs) ? remoteAssetsDiffs : [];
  const filesDiffHistory: DiffEntry[] = Array.isArray(remoteFilesDiffs) ? remoteFilesDiffs : [];

  const computedAssetsDiff = computeValueBasedDiff(remoteAssets || {}, assetsJson);
  const hasAssetsChanges =
    Object.keys(computedAssetsDiff.added).length > 0 ||
    Object.keys(computedAssetsDiff.removed).length > 0;

  if (hasAssetsChanges) {
    assetsDiffHistory.push({
      date: currentDate,
      added: computedAssetsDiff.added,
      removed: computedAssetsDiff.removed,
    });
  }

  const remoteFilesFlattened = {
    ...remoteFiles?.modern,
    ...remoteFiles?.retro,
    ...remoteFiles?.other,
  };
  const localFilesFlattened = {
    ...filesJson.modern,
    ...filesJson.retro,
    ...filesJson.other,
  };
  const computedFilesDiff = computeValueBasedDiff(remoteFilesFlattened, localFilesFlattened);
  const hasFilesChanges =
    Object.keys(computedFilesDiff.added).length > 0 ||
    Object.keys(computedFilesDiff.removed).length > 0;

  if (hasFilesChanges) {
    filesDiffHistory.push({
      date: currentDate,
      added: computedFilesDiff.added,
      removed: computedFilesDiff.removed,
    });
  }

  mkdirSync("./dist/diffs", { recursive: true });

  writeFileSync("./dist/assets.json", JSON.stringify(assetsJson, null, 2), "utf-8");
  writeFileSync("./dist/files.json", JSON.stringify(filesJson, null, 2), "utf-8");
  writeFileSync("./dist/diffs/assets.json", JSON.stringify(assetsDiffHistory, null, 2), "utf-8");
  writeFileSync("./dist/diffs/files.json", JSON.stringify(filesDiffHistory, null, 2), "utf-8");

  const totalFiles =
    Object.keys(filesJson.modern).length +
    Object.keys(filesJson.retro).length +
    Object.keys(filesJson.other).length;

  console.log(`[5/5] Extraction & Diff check complete!`);
  console.log(` - Saved ${totalFiles} mapped files into files.json`);
  console.log(
    ` - Assets Diffs History -> Total entries: ${assetsDiffHistory.length} (Appended new: ${hasAssetsChanges})`,
  );
  console.log(
    ` - Files Diffs History  -> Total entries: ${filesDiffHistory.length} (Appended new: ${hasFilesChanges})`,
  );
}

const TARGET_URL = process.argv[2] || "https://howdidwelosethisworld.com";
extractAllAssets(TARGET_URL).catch(console.error);
