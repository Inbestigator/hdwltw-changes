import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LaunchOptions, PuppeteerNode } from "puppeteer";

interface AssetsMap {
  [varName: string]: string;
}

interface FilesMap {
  modern: Record<string, string>;
  retro: Record<string, string>;
  other: Record<string, string>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function extractAllAssets(targetUrl: string) {
  console.log(`[1/4] Launching browser and fetching scripts from ${targetUrl}...`);

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

  // Capture script responses directly from the network stream
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
    `[2/4] Intercepted ${scriptContents.length} JavaScript files. Parsing across all files...`,
  );

  const assetsJson: AssetsMap = {};
  const filesJson: FilesMap = {
    modern: {},
    retro: {},
    other: {},
  };

  // Step 1: Scan ALL scripts for variable asset assignments
  // Matches: const A="/assets/xyz.webp", A="/assets/xyz.webp", or var/let
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
    `[3/4] Extracted ${Object.keys(assetsJson).length} variable mappings to assets.json.`,
  );

  // Step 2: Flexibly capture file path mappings across ALL scripts
  // Catches both variable mapped keys: "./file.jpg": A
  // AND direct string mapped keys:    "./file.jpg": "/assets/abc.webp"
  const filePairRegex =
    /["'](\.?\/?assets\/files\/[^"']+|(?:\.\.\/)+assets\/[^"']+)["']\s*:\s*([a-zA-Z0-9_$]+|["']\/assets\/[^"']+["'])/g;

  for (const script of scriptContents) {
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: ignore
    while ((match = filePairRegex.exec(script.code)) !== null) {
      const [, filePath, rawValue] = match;
      if (!filePath || !rawValue) continue;

      let resolvedUrl: string | undefined;

      // Case A: Value is a direct string literal "/assets/xyz.webp"
      if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
        resolvedUrl = rawValue.slice(1, -1);
      }
      // Case B: Value is a variable reference look up in assetsJson
      else if (assetsJson[rawValue]) {
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

  mkdirSync("./dist", { recursive: true });

  // Step 3: Write Output Files
  writeFileSync("./dist/assets.json", JSON.stringify(assetsJson, null, 2), "utf-8");
  writeFileSync("./dist/files.json", JSON.stringify(filesJson, null, 2), "utf-8");

  const totalFiles =
    Object.keys(filesJson.modern).length +
    Object.keys(filesJson.retro).length +
    Object.keys(filesJson.other).length;

  console.log(`[4/4] Extraction complete! Saved ${totalFiles} total mapped files into files.json.`);
}

const TARGET_URL = process.argv[2] || "https://howdidwelosethisworld.com";
extractAllAssets(TARGET_URL).catch(console.error);
