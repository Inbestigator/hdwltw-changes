import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

// Define the structure of the input manifest
interface AssetManifest {
  [category: string]: {
    [originalPath: string]: string;
  };
}

interface ProcessedMediaItem {
  originalPath: string;
  filename: string;
  resolvedUrl: string;
  isVideo: boolean;
  subFolder: string;
}

interface OrganizedGroup {
  categoryName: string;
  subGroups: Record<string, ProcessedMediaItem[]>;
}

const BASE_URL = "https://howdidwelosethisworld.com";

function parseAssetManifest(jsonData: AssetManifest): OrganizedGroup[] {
  const result: OrganizedGroup[] = [];

  for (const [category, items] of Object.entries(jsonData)) {
    const subGroups: Record<string, ProcessedMediaItem[]> = {};

    for (const [originalPath, assetPath] of Object.entries(items)) {
      // Re-root the path to the target domain
      // Extracts base asset path e.g. "/assets/t4D5ixdY.webp" -> "https://howdidwelosethisworld.com/assets/t4D5ixdY.webp"
      const cleanAssetPath = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
      const resolvedUrl = `${BASE_URL}${cleanAssetPath}`;

      // Extract details from original file path
      const pathParts = originalPath.replace(/^\.\//, "").split("/");
      const filename = pathParts[pathParts.length - 1];
      if (!filename) continue;
      const ext = path.extname(filename).toLowerCase();
      const isVideo = ext === ".mp4" || ext === ".webm";

      // Group by subfolder (e.g. "episode-1", "silo-drive", "surveillance")
      let subFolder = "General";
      if (pathParts.length > 2) {
        subFolder = pathParts.slice(1, -1).join(" / ");
      } else if (pathParts.length === 2) {
        if (!pathParts[0]) continue;
        subFolder = pathParts[0];
      }

      const mediaItem: ProcessedMediaItem = {
        originalPath,
        filename,
        resolvedUrl,
        isVideo,
        subFolder,
      };

      if (!subGroups[subFolder]) {
        subGroups[subFolder] = [];
      }
      subGroups[subFolder]?.push(mediaItem);
    }

    result.push({
      categoryName: category,
      subGroups,
    });
  }

  return result;
}

function generateHTMLGallery(groups: OrganizedGroup[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asset Archive Gallery</title>
  <meta name="description" content="Assets from howdidwelosethisworld.comm extracted for easy reference" />
  <meta name="theme-color" content="#0f1117" />
  <meta property="og:title" content="Asset Archive Gallery" />
  <meta name="og:description" content="Assets from howdidwelosethisworld.com, extracted for easy reference" />
  <meta property="og:site_name" content="How Did We Lose This World" />
  <style>
    :root {
      --bg-color: #0f1117;
      --card-bg: #1a1d24;
      --accent: #3b82f6;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-color);
      color: var(--text);
      padding: 2rem;
      line-height: 1.5;
    }

    header {
      margin-bottom: 2.5rem;
      border-bottom: 1px solid #2d3748;
      padding-bottom: 1rem;
    }

    h1 { font-size: 2.25rem; font-weight: 700; color: #fff; }
    .subtitle { color: var(--text-muted); margin-top: 0.5rem; }

    section.category {
      margin-bottom: 3rem;
    }

    .category-title {
      font-size: 1.75rem;
      text-transform: capitalize;
      color: var(--accent);
      margin-bottom: 1.5rem;
      border-left: 4px solid var(--accent);
      padding-left: 0.75rem;
    }

    .subfolder-title {
      font-size: 1.1rem;
      color: var(--text-muted);
      margin: 1.5rem 0 1rem 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1.25rem;
    }

    .card {
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #2d3748;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 20px rgba(0,0,0,0.4);
    }

    .media-container {
      width: 100%;
      height: 180px;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .media-container img, .media-container video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .badge {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0,0,0,0.75);
      color: #fff;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }

    .card-info {
      padding: 0.75rem;
    }

    .filename {
      font-size: 0.85rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .path {
      font-size: 0.75rem;
      color: var(--text-muted);
      word-break: break-all;
      margin-top: 0.25rem;
    }

    a.media-link {
      text-decoration: none;
      color: inherit;
    }
  </style>
</head>
<body>

  <header>
    <h1>Asset Archive Gallery</h1>
    <p class="subtitle">Assets from <code>${BASE_URL}</code></p>
  </header>

  <main>
    ${groups
      .map(
        (group) => `
      <section class="category">
        <h2 class="category-title">${group.categoryName}</h2>
        ${Object.entries(group.subGroups)
          .map(
            ([subFolder, items]) => `
          <h3 class="subfolder-title">${subFolder}</h3>
          <div class="grid">
            ${items
              .map(
                (item) => `
              <div class="card">
                <a href="${item.resolvedUrl}" target="_blank" class="media-link">
                  <div class="media-container">
                    ${
                      item.isVideo
                        ? `<video src="${item.resolvedUrl}" controls preload="metadata"></video><span class="badge">VIDEO</span>`
                        : `<img src="${item.resolvedUrl}" alt="${item.filename}" loading="lazy" />`
                    }
                  </div>
                  <div class="card-info">
                    <div class="filename" title="${item.filename}">${item.filename}</div>
                    <div class="path" title="${item.originalPath}">${item.originalPath}</div>
                  </div>
                </a>
              </div>
            `,
              )
              .join("")}
          </div>
        `,
          )
          .join("")}
      </section>
    `,
      )
      .join("")}
  </main>

</body>
</html>`;
}

// Execution block
const inputData: AssetManifest = /* YOUR JSON OBJECT HERE */ JSON.parse(
  readFileSync("./dist/files.json", "utf-8"),
);

const parsedData = parseAssetManifest(inputData);
const htmlContent = generateHTMLGallery(parsedData);

// Save output
writeFileSync("./dist/index.html", htmlContent, "utf-8");
console.log("Gallery generated successfully at index.html");
