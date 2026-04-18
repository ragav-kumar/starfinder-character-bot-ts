import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(projectRoot, "templates");
const destinationDir = path.join(projectRoot, "dist", "templates");

await mkdir(destinationDir, { recursive: true });
await cp(sourceDir, destinationDir, { recursive: true });
