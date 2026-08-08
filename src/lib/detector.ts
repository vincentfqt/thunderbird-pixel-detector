// src/lib/detector.ts
// Détection des pixels de suivi dans le HTML d'un email.
//
// Les contenus distants analysés sont les balises <img> et les images de fond
// CSS (background-image). On ne charge JAMAIS ces contenus : les charger
// reviendrait à prévenir le serveur de suivi que l'email a été ouvert.

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
// La liste s'appuie sur les paramètres observés chez les plateformes de
// tracking d'emails (voir aussi l'outil open source PixelGuard).
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
	"campaign_id",
	"email",
	"token",
	"recipient",
	"subscriber",
	"signature",
	"rid",
	"cid",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
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
	/** Attribut style de la balise, pour repérer les images masquées par CSS. */
	style: string | null;
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
		style: string | null = null,
	): void => {
		// Une même URL revient souvent plusieurs fois : on ne l'analyse qu'une fois.
		if (!isRemoteUrl(url) || seen.has(url)) return;
		seen.add(url);

		images.push({
			url,
			width: parseDimension(width),
			height: parseDimension(height),
			style,
		});
	};

	// Balises <img>.
	for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
		const tag = match[0];
		const style = getAttribute(tag, "style");

		addImage(
			getAttribute(tag, "src") ?? "",
			getAttribute(tag, "width"),
			getAttribute(tag, "height"),
			style,
		);

		// Images à chargement différé : l'URL réelle est ailleurs que dans src
		// (srcset, data-src ou data-original).
		for (const url of extractSrcsetUrls(getAttribute(tag, "srcset"))) {
			addImage(url, null, null, style);
		}
		const lazySrc =
			getAttribute(tag, "data-src") ?? getAttribute(tag, "data-original");
		if (lazySrc !== null) {
			addImage(lazySrc, null, null, style);
		}
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
	// Une image déjà 1×1 est signalée : inutile d'ajouter une raison CSS en plus.
	const hiddenReason = isOneByOne ? null : cssHiddenReason(image.style);
	const fileName = suspiciousFileName(image.url);
	const reasons: string[] = [];

	if (isOneByOne) {
		reasons.push("Image de 1×1 px");
	}
	if (hiddenReason !== null) {
		reasons.push(hiddenReason);
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

	// Un pixel est signalé s'il est invisible (1×1 ou masqué par CSS), s'il
	// porte un nom de fichier typique, ou si au moins deux indices sont réunis.
	const isSuspicious =
		isOneByOne ||
		hiddenReason !== null ||
		fileName !== null ||
		reasons.length >= 2;
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

/** URLs d'un attribut srcset ("url 1x, url 2x" → ["url", "url"]). */
function extractSrcsetUrls(srcset: string | null): string[] {
	if (srcset === null) return [];
	return srcset
		.split(",")
		.map((part) => part.trim().split(/\s+/)[0])
		.filter((url) => url !== "");
}

/**
 * Raison de signalement si le style CSS rend l'image invisible, sinon null.
 * Les trackers ne font pas que du 1×1 : ils masquent aussi leurs pixels avec
 * display: none, une opacité nulle ou des dimensions CSS minuscules.
 */
function cssHiddenReason(style: string | null): string | null {
	if (style === null) return null;
	const css = style.toLowerCase();

	if (hasCssDeclaration(css, "display", "none")) {
		return "Masquée par CSS (display: none)";
	}
	if (hasCssDeclaration(css, "visibility", "hidden")) {
		return "Masquée par CSS (visibility: hidden)";
	}
	if (hasCssDeclaration(css, "opacity", "0(\\.0+)?")) {
		return "Masquée par CSS (opacity: 0)";
	}

	const hasTinyCssSize = ["width", "height", "max-width", "max-height"].some(
		(property) =>
			(cssDimension(css, property) ?? Number.POSITIVE_INFINITY) <= 1,
	);
	if (hasTinyCssSize) {
		return "Dimensions CSS minuscules";
	}

	return null;
}

/** true si le style contient `propriété: valeur` (suivi de ; ! ou de la fin). */
function hasCssDeclaration(
	style: string,
	property: string,
	value: string,
): boolean {
	return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*${value}(?:[;!]|$)`).test(
		style,
	);
}

/** Valeur numérique d'une propriété CSS (ex. "1px" → 1), sinon null. */
function cssDimension(style: string, property: string): number | null {
	const match = style.match(
		new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;!]+)`),
	);
	return match === null ? null : parseDimension(match[1] ?? null);
}

/** Convertit "1" ou "1px" en 1 ; renvoie null si absent ou non numérique. */
function parseDimension(value: string | null): number | null {
	const match = value?.match(/\d+/);
	return match === undefined || match === null ? null : Number(match[0]);
}

/**
 * true si l'URL pointe vers un serveur distant : http(s):// ou protocole
 * relatif (//cdn.example.com/…). Les URLs protocole-relatives sont fréquentes
 * dans les newsletters, sans indication de schéma.
 */
function isRemoteUrl(url: string): boolean {
	return /^(?:https?:)?\/\//i.test(url);
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

/**
 * Parse une URL sans lever d'exception. Les URLs protocole-relatives
 * (//example.com/…) sont parsées comme https : new URL les refuse sans base,
 * mais elles désignent bien un serveur distant.
 */
function parseUrl(url: string): URL | null {
	try {
		return new URL(url.startsWith("//") ? `https:${url}` : url);
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
