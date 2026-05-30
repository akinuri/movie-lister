#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

function parseArgs(argv) {
    const args = {
        input: "movies.json",
        outputDir: "posters",
        delayMs: 1000,
        retries: 2,
        timeoutMs: 15000,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--input" || arg === "-i") {
            args.input = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--output-dir" || arg === "-o") {
            args.outputDir = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--delay-ms" || arg === "-d") {
            args.delayMs = Number(argv[i + 1]);
            i += 1;
            continue;
        }

        if (arg === "--retries" || arg === "-r") {
            args.retries = Number(argv[i + 1]);
            i += 1;
            continue;
        }

        if (arg === "--timeout-ms" || arg === "-t") {
            args.timeoutMs = Number(argv[i + 1]);
            i += 1;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node download-posters.js [--input movies.json] [--output-dir posters] [--delay-ms 1000] [--retries 2] [--timeout-ms 15000]

Defaults:
  --input      movies.json
  --output-dir posters
  --delay-ms   1000
  --retries    2
  --timeout-ms 15000

Notes:
  - Uses imdbID as filename (e.g. tt1413492.jpg)
  - Skips files that already exist
  - Downloads one-by-one with delay to reduce rate-limit risk
`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNumber(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function readMovies(filePath) {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
        throw new Error("movies.json must contain a JSON array.");
    }

    return parsed;
}

function extensionFromUrl(urlString) {
    try {
        const url = new URL(urlString);
        const ext = path.extname(url.pathname).toLowerCase();
        if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp") {
            return ext === ".jpeg" ? ".jpg" : ext;
        }
        return ".jpg";
    } catch {
        return ".jpg";
    }
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                "user-agent": "movs-displayer-poster-downloader/1.0",
            },
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function downloadPoster(url, outputPath, retries, timeoutMs) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, timeoutMs);

            if (!response.ok) {
                const retryable = response.status === 429 || response.status >= 500;
                if (retryable && attempt < retries) {
                    await sleep(500 * (attempt + 1));
                    continue;
                }
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(outputPath, buffer);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleep(500 * (attempt + 1));
                continue;
            }
        }
    }

    throw lastError || new Error("Unknown download error");
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    args.delayMs = safeNumber(args.delayMs, 1000);
    args.retries = safeNumber(args.retries, 2);
    args.timeoutMs = safeNumber(args.timeoutMs, 15000);

    const inputPath = path.resolve(process.cwd(), args.input);
    const outputDirPath = path.resolve(process.cwd(), args.outputDir);

    await fs.mkdir(outputDirPath, { recursive: true });
    const movies = await readMovies(inputPath);

    let totalCandidates = 0;
    let skippedMissingInfo = 0;
    let skippedExisting = 0;
    let downloaded = 0;
    let failed = 0;

    for (const movie of movies) {
        const imdbID = String(movie.imdbID || "").trim();
        const posterUrl = String(movie.Poster || "").trim();

        if (!imdbID || !posterUrl || posterUrl === "N/A") {
            skippedMissingInfo += 1;
            continue;
        }

        totalCandidates += 1;

        const ext = extensionFromUrl(posterUrl);
        const outputFilePath = path.join(outputDirPath, `${imdbID}${ext}`);

        if (await fileExists(outputFilePath)) {
            skippedExisting += 1;
            continue;
        }

        process.stdout.write(`Downloading: ${movie.Title || imdbID} -> ${path.basename(outputFilePath)} ... `);

        try {
            await downloadPoster(posterUrl, outputFilePath, args.retries, args.timeoutMs);
            downloaded += 1;
            process.stdout.write("ok\n");
        } catch (error) {
            failed += 1;
            process.stdout.write(`error: ${error.message}\n`);
        }

        if (args.delayMs > 0) {
            await sleep(args.delayMs);
        }
    }

    console.log("\nDone.");
    console.log(`Movies in input: ${movies.length}`);
    console.log(`Poster candidates: ${totalCandidates}`);
    console.log(`Skipped (missing imdbID/poster): ${skippedMissingInfo}`);
    console.log(`Skipped (already downloaded): ${skippedExisting}`);
    console.log(`Downloaded: ${downloaded}`);
    console.log(`Failed: ${failed}`);
    console.log(`Output folder: ${outputDirPath}`);
}

main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
