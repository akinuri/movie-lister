#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

function parseArgs(argv) {
    const args = {
        input: "movies.txt",
        output: "movies.json",
        apiKey: process.env.OMDB_API_KEY || "",
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--input" || arg === "-i") {
            args.input = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--output" || arg === "-o") {
            args.output = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--api-key" || arg === "-k") {
            args.apiKey = argv[i + 1];
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
  node sync-movies.js [--input movies.txt] [--output movies.json] [--api-key YOUR_KEY]

Defaults:
  --input   movies.txt
  --output  movies.json
  --api-key from OMDB_API_KEY env var
`);
}

function normalizeTitle(title) {
    let t = String(title || "").trim().toLowerCase();
    // Remove leading 'the ' for sorting/comparison
    if (t.startsWith("the ")) {
        t = t.slice(4);
    }
    return t.replace(/\s+/g, " ");
}

function movieKey(title, year) {
    return `${normalizeTitle(title)}::${String(year || "").trim()}`;
}

function compareMovies(a, b) {
    const titleCompare = normalizeTitle(a.Title).localeCompare(normalizeTitle(b.Title));
    if (titleCompare !== 0) {
        return titleCompare;
    }

    const yearA = String(a.Year || "").trim();
    const yearB = String(b.Year || "").trim();
    return yearA.localeCompare(yearB);
}

function parseMovieLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    // Matches: "Movie Title (2024)" and also supports lines without year.
    const match = trimmed.match(/^(.*?)\s*(?:\((\d{4})\))?$/);
    if (!match) {
        return null;
    }

    const title = (match[1] || "").trim();
    const year = (match[2] || "").trim();

    if (!title) {
        return null;
    }

    return { title, year };
}

async function readMoviesTxt(filePath) {
    const content = await fs.readFile(filePath, "utf8");
    return content.split(/\r?\n/).map(parseMovieLine).filter(Boolean);
}

async function readExistingMovies(filePath) {
    try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            throw new Error("movies.json must contain a JSON array.");
        }
        return parsed;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

async function fetchOmdbByTitle(title, year, apiKey) {
    const params = new URLSearchParams({
        t: title,
        apikey: apiKey,
    });

    if (year) {
        params.set("y", year);
    }

    const url = `https://www.omdbapi.com/?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`OMDb request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.Response === "True") {
        return data;
    }

    return null;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.apiKey) {
        throw new Error("Missing OMDb API key. Provide --api-key or set OMDB_API_KEY.");
    }

    const inputPath = path.resolve(process.cwd(), args.input);
    const outputPath = path.resolve(process.cwd(), args.output);

    const requestedMovies = await readMoviesTxt(inputPath);
    const existingMovies = await readExistingMovies(outputPath);

    // Build a set of keys for deduplication, including both OMDb and queried titles/years
    const existingSet = new Set();
    for (const movie of existingMovies) {
        existingSet.add(movieKey(movie.Title, movie.Year));
        if (movie.QueriedTitle) {
            existingSet.add(movieKey(movie.QueriedTitle, movie.QueriedYear));
        }
    }

    const fetchedMovies = [];
    let skippedExisting = 0;
    let failed = 0;

    for (const movie of requestedMovies) {
        const key = movieKey(movie.title, movie.year);

        if (existingSet.has(key)) {
            skippedExisting += 1;
            continue;
        }

        process.stdout.write(`Fetching: ${movie.title}${movie.year ? ` (${movie.year})` : ""} ... `);

        try {
            // Build the OMDb URL for manual check
            const params = new URLSearchParams({ t: movie.title, apikey: args.apiKey });
            if (movie.year) params.set("y", movie.year);
            const omdbUrl = `https://www.omdbapi.com/?${params.toString()}`;

            const data = await fetchOmdbByTitle(movie.title, movie.year, args.apiKey);

            if (!data) {
                failed += 1;
                process.stdout.write(`not found\n  ${omdbUrl}\n`);
                continue;
            }

            // Store queried title/year for future deduplication
            data.QueriedTitle = movie.title;
            data.QueriedYear = movie.year;

            fetchedMovies.push(data);
            existingSet.add(key);
            // Also add OMDb title/year and queried title/year to set
            existingSet.add(movieKey(data.Title, data.Year));
            existingSet.add(movieKey(data.QueriedTitle, data.QueriedYear));
            process.stdout.write("ok\n");
        } catch (error) {
            failed += 1;
            process.stdout.write(`error: ${error.message}\n`);
        }
    }

    const merged = [...existingMovies, ...fetchedMovies].sort(compareMovies);
    await fs.writeFile(outputPath, JSON.stringify(merged, null, 4) + "\n", "utf8");

    console.log("\nDone.");
    console.log(`Total in input: ${requestedMovies.length}`);
    console.log(`Skipped existing: ${skippedExisting}`);
    console.log(`Fetched new: ${fetchedMovies.length}`);
    console.log(`Failed/not found: ${failed}`);
    console.log(`Output file: ${outputPath}`);
}

main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
