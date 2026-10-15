import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(rootDirectory, "package.json");
const manifestPath = resolve(rootDirectory, "public", "manifest.json");
const bumpType = process.argv[2];

if (!["patch", "minor", "major"].includes(bumpType)) {
	console.error("Usage : pnpm release:patch | release:minor | release:major");
	process.exit(1);
}

function run(command, argumentsList, options = {}) {
	const executable =
		process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
	const result = spawnSync(executable, argumentsList, {
		cwd: rootDirectory,
		stdio: "inherit",
		...options,
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`La commande ${command} ${argumentsList.join(" ")} a échoué.`,
		);
	}
}

function readGit(argumentsList) {
	const result = spawnSync("git", argumentsList, {
		cwd: rootDirectory,
		encoding: "utf8",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`La commande git ${argumentsList.join(" ")} a échoué.`);
	}

	return result.stdout.trim();
}

function nextVersion(currentVersion, type) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);

	if (!match) {
		throw new Error(
			`Version invalide : ${currentVersion}. La version doit respecter le format X.Y.Z.`,
		);
	}

	let major = Number(match[1]);
	let minor = Number(match[2]);
	let patch = Number(match[3]);

	if (type === "major") {
		major += 1;
		minor = 0;
		patch = 0;
	} else if (type === "minor") {
		minor += 1;
		patch = 0;
	} else {
		patch += 1;
	}

	return `${major}.${minor}.${patch}`;
}

function updateVersion(source, version) {
	const data = JSON.parse(source);
	data.version = version;
	return `${JSON.stringify(data, null, "\t")}\n`;
}

const originalPackageSource = readFileSync(packagePath, "utf8");
const originalManifestSource = readFileSync(manifestPath, "utf8");
const packageJson = JSON.parse(originalPackageSource);
const manifestJson = JSON.parse(originalManifestSource);

if (packageJson.version !== manifestJson.version) {
	console.error(
		`Versions désynchronisées : package.json=${packageJson.version}, public/manifest.json=${manifestJson.version}.`,
	);
	process.exit(1);
}

const currentVersion = packageJson.version;
const version = nextVersion(currentVersion, bumpType);
const tag = `v${version}`;
let releaseCommitted = false;
let releaseStaged = false;

try {
	const status = readGit(["status", "--porcelain"]);
	if (status) {
		throw new Error(
			"La release exige un arbre Git propre. Commitez ou rangez les changements locaux avant de continuer.",
		);
	}

	if (readGit(["tag", "--list", tag])) {
		throw new Error(`Le tag ${tag} existe déjà.`);
	}

	writeFileSync(packagePath, updateVersion(originalPackageSource, version));
	writeFileSync(manifestPath, updateVersion(originalManifestSource, version));

	console.log(`Préparation de la release ${version}...`);
	run("pnpm", ["test", "--", "--run"]);
	run("pnpm", ["run", "lint"]);
	run("pnpm", ["tb:lint"]);
	run("pnpm", ["tb:build"]);

	releaseStaged = true;
	run("git", ["add", "package.json", "public/manifest.json"]);
	run("git", ["commit", "-m", `chore: release ${tag}`]);
	releaseCommitted = true;
	run("git", ["tag", "--annotate", tag, "--message", `Release ${tag}`]);

	console.log(`Release ${tag} créée avec succès.`);
} catch (error) {
	if (!releaseCommitted) {
		writeFileSync(packagePath, originalPackageSource);
		writeFileSync(manifestPath, originalManifestSource);
		if (releaseStaged) {
			try {
				run("git", ["reset", "--", "package.json", "public/manifest.json"]);
			} catch (cleanupError) {
				console.error(
					`Nettoyage de l'index Git impossible : ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
				);
			}
		}
	}

	console.error(error instanceof Error ? error.message : error);
	if (releaseCommitted) {
		console.error(`Le commit ${tag} existe, mais le tag n'a pas pu être créé.`);
	}
	process.exitCode = 1;
}
