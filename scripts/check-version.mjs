import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(rootDirectory, "package.json");
const manifestPath = resolve(rootDirectory, "public", "manifest.json");

const [packageSource, manifestSource] = await Promise.all([
	readFile(packagePath, "utf8"),
	readFile(manifestPath, "utf8"),
]);

const packageVersion = JSON.parse(packageSource).version;
const manifestVersion = JSON.parse(manifestSource).version;

if (packageVersion !== manifestVersion) {
	console.error(
		`Versions désynchronisées : package.json=${packageVersion}, public/manifest.json=${manifestVersion}.`,
	);
	console.error(
		"Utilisez une commande release:patch, release:minor ou release:major pour les modifier ensemble.",
	);
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
	console.error(
		`Version invalide : ${packageVersion}. La version doit respecter le format X.Y.Z.`,
	);
	process.exit(1);
}
