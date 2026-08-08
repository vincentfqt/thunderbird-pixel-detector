// src/lib/detector.ts
// Détection des pixels de suivi dans le HTML d'un email.
//
// Principe : on analyse uniquement le HTML du message. On ne charge JAMAIS
// les images distantes : les charger reviendrait à prévenir le serveur de
// suivi que l'email a été ouvert.

export interface TrackingPixel {
	url: string;
	width: number | null;
	height: number | null;
	/** Pourquoi cette image est considérée comme un pixel. */
	reasons: string[];
}

export interface AnalysisResult {
	/** Nombre total d'images distantes dans le message. */
	remoteImageCount: number;
	/** Images classées comme pixels de suivi. */
	trackingPixels: TrackingPixel[];
	/** Erreur éventuelle (ex. aucun message affiché). */
	error?: string;
}

// Mot-clés présents dans les domaines, chemins ou noms de fichiers utilisés
// par les plateformes de tracking d'emails. La recherche est volontairement
// simple (sous-chaîne) : elle peut sur-signaler, mais le popup affiche les
// raisons pour que l'utilisateur juge.
const TRACKING_WORDS = [
	"track",
	"tracking",
	"pixel",
	"beacon",
	"open",
	"click",
	"email",
	"newsletter",
	"campaign",
	"mailer",
	"esp",
	"trk",
];

// Paramètres d'URL typiques d'un pixel de suivi (ex. ?open=…&mid=…).
const TRACKING_PARAMS = [
	"open",
	"open_id",
	"track",
	"tracking",
	"trk",
	"tid",
	"mid",
	"message_id",
	"uid",
	"campaign",
	"email",
];

// Noms de fichiers typiques d'un pixel de suivi (sans l'extension).
const PIXEL_FILE_NAMES = [
	"pixel",
	"beacon",
	"spacer",
	"clear",
	"blank",
	"transparent",
	"1x1",
	"open",
	"track",
	"tracking",
	"pix",
	"px",
	"dot",
];

/** Image distante extraite du HTML. */
interface ExtractedImage {
	url: string;
	width: number | null;
	height: number | null;
}

/**
 * Détecte les pixels de suivi dans le HTML d'un message.
 * Renvoie les pixels détectés et le nombre total d'images distantes.
 */
export function detectTrackingPixels(html: string): AnalysisResult {
	const images = extractRemoteImages(html);
	const trackingPixels = images
		.map(analyzeImage)
		.filter((pixel): pixel is TrackingPixel => pixel !== null);

	return {
		remoteImageCount: images.length,
		trackingPixels,
	};
}

// --- Extraction ------------------------------------------------------------

/**
 * Extrait les images distantes du HTML : balises <img> et images de fond
 * CSS (style="background-image: url(…)"). Les images embarquées (cid:,
 * data:) sont ignorées.
 */
function extractRemoteImages(html: string): ExtractedImage[] {
	const images: ExtractedImage[] = [];
	const seen = new Set<string>();

	const addImage = (
		url: string,
		width: string | null,
		height: string | null,
	): void => {
		// Une même URL revient souvent plusieurs fois : on ne l'analyse qu'une fois.
		if (!isRemoteUrl(url) || seen.has(url)) return;
		seen.add(url);

		images.push({
			url,
			width: parseDimension(width),
			height: parseDimension(height),
		});
	};

	// Balises <img>.
	for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
		const tag = match[0];
		addImage(
			getAttribute(tag, "src") ?? "",
			getAttribute(tag, "width"),
			getAttribute(tag, "height"),
		);
	}

	// Images de fond CSS : <div style="background-image: url(...)">.
	for (const match of html.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
		const style = match[1] ?? match[2] ?? "";
		const urlMatch = style.match(
			/background(?:-image)?\s*:\s*[^;]*?url\(["']?([^"')]+)["']?\)/i,
		);
		if (urlMatch !== null) {
			addImage(urlMatch[1] ?? "", null, null);
		}
	}

	return images;
}

// --- Analyse ---------------------------------------------------------------

/**
 * Analyse une image et renvoie un pixel de suivi si elle semble suspecte,
 * sinon null.
 */
function analyzeImage(image: ExtractedImage): TrackingPixel | null {
	const isOneByOne = image.width === 1 && image.height === 1;
	const fileName = suspiciousFileName(image.url);
	const reasons: string[] = [];

	if (isOneByOne) {
		reasons.push("Image de 1×1 px");
	}
	if (fileName !== null) {
		reasons.push(`Nom de fichier suspect (${fileName})`);
	}
	if (urlContainsWord(image.url, TRACKING_WORDS)) {
		reasons.push("Domaine ou chemin lié au suivi");
	}
	const trackingParams = findTrackingParams(image.url);
	if (trackingParams.length > 0) {
		reasons.push(`Paramètres de suivi (${trackingParams.join(", ")})`);
	}

	// Un pixel est signalé s'il fait 1×1 px, s'il porte un nom de fichier
	// typique, ou si au moins deux indices sont réunis.
	const isSuspicious = isOneByOne || fileName !== null || reasons.length >= 2;
	if (!isSuspicious) return null;

	return {
		url: image.url,
		width: image.width,
		height: image.height,
		reasons,
	};
}

// --- Helpers ---------------------------------------------------------------

/** Lit un attribut d'une balise HTML : name="…", name='…' ou name=…. */
function getAttribute(tag: string, name: string): string | null {
	const match = tag.match(
		new RegExp(
			`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
			"i",
		),
	);
	return match === null ? null : (match[1] ?? match[2] ?? match[3]);
}

/** Convertit "1" ou "1px" en 1 ; renvoie null si absent ou non numérique. */
function parseDimension(value: string | null): number | null {
	const match = value?.match(/\d+/);
	return match === undefined || match === null ? null : Number(match[0]);
}

/** true si l'URL pointe vers un serveur distant (http ou https). */
function isRemoteUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

/** Nom de fichier de l'URL s'il est typique d'un pixel de suivi, sinon null. */
function suspiciousFileName(url: string): string | null {
	const path = parseUrl(url)?.pathname ?? "";
	const fileName = path.split("/").pop()?.toLowerCase() ?? "";
	const base = fileName.replace(/\.[a-z0-9]+$/, "");

	if (PIXEL_FILE_NAMES.includes(base)) {
		return fileName;
	}
	return null;
}

/** true si le domaine ou le chemin de l'URL contient un mot-clé de suivi. */
function urlContainsWord(url: string, words: string[]): boolean {
	const parsed = parseUrl(url);
	if (parsed === null) return false;

	const hostAndPath = `${parsed.hostname} ${parsed.pathname}`;
	return words.some((word) => hostAndPath.toLowerCase().includes(word));
}

/** Paramètres de l'URL reconnus comme liés au suivi. */
function findTrackingParams(url: string): string[] {
	const parsed = parseUrl(url);
	if (parsed === null) return [];

	return [...parsed.searchParams.keys()].filter((name) =>
		TRACKING_PARAMS.includes(name.toLowerCase()),
	);
}

/** Parse une URL sans lever d'exception. */
function parseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

// --- Corps du message --------------------------------------------------------

/**
 * Cherche le corps HTML dans la structure renvoyée par messages.getFull
 * (qui peut être multipart). Renvoie null si le message n'a pas de partie HTML.
 */
export function findHtmlBody(part: ThunderbirdMessagePart): string | null {
	const contentType = part.contentType?.toLowerCase() ?? "";

	if (contentType.includes("text/html")) {
		return part.body ?? null;
	}

	if (contentType.includes("multipart")) {
		for (const child of part.parts ?? []) {
			const body = findHtmlBody(child);
			if (body !== null) return body;
		}
	}

	return null;
}
