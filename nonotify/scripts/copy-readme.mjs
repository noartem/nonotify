import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const sourceReadme = path.resolve(packageDir, "..", "README.md");
const targetReadme = path.resolve(packageDir, "README.md");

await mkdir(packageDir, { recursive: true });
await copyFile(sourceReadme, targetReadme);
