// src/lib/detector.ts
// Détection des pixels de suivi dans le HTML d'un email.
//
// Les contenus distants analysés sont les balises <img> et les images de fond
// CSS (background-image). On ne charge JAMAIS ces contenus : les charger
// reviendrait à prévenir le serveur de suivi que l'email a été ouvert.

// Les modèles (TrackingPixel, AnalysisResult…) sont définis dans src/models/ et
// ré-exportés ici : le reste de l'app continue d'importer depuis lib/detector.
import type {
	AnalysisResult,
	TrackingLink,
	TrackingPixel,
	TrackingResource,
} from "../models/tracking";

export type {
	AnalysisResult,
	TrackingLink,
	TrackingPixel,
	TrackingResource,
} from "../models/tracking";

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

// Paramètres d'URL d'une redirection : le clic passe par un serveur de suivi
// qui redirige ensuite vers la vraie destination (click-tracker).
const REDIRECT_PARAMS = [
	"url",
	"redirect",
	"redirect_url",
	"redirect_to",
	"dest",
	"destination",
	"target",
	"goto",
	"next",
	"continue",
	"return",
	"ref",
	"link",
];

// Mots-clés des domaines de redirection de clics (click.example.com, go.…).
const CLICK_WORDS = ["click", "track", "trk", "redirect", "go", "mailer"];

// Balises HTML qui chargent une ressource distante sans être des images.
// Un web beacon peut être porté par n'importe quel élément qui déclenche un
// téléchargement (iframe, feuille de style, média…).
const RESOURCE_TAGS = [
	"iframe",
	"frame",
	"link",
	"embed",
	"object",
	"video",
	"audio",
	"source",
	"track",
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
/**
 * Analyse le HTML d'un message : pixels de suivi (<img>), liens de suivi des
 * clics (<a href>) et ressources distantes suspectes. Renvoie les menaces
 * détectées et le nombre total d'images distantes. Aucun contenu distant n'est
 * chargé : on travaille uniquement sur le source.
 */
export function detectTrackingThreats(html: string): AnalysisResult {
	const images = extractRemoteImages(html);
	// Un style global (ex. img { display:none }) masque toutes les images :
	// on le passe à chaque image analysée.
	const globalCssReason = findGlobalCssHiding(html);
	const trackingPixels = images
		.map((image) => analyzeImage(image, globalCssReason))
		.filter((pixel): pixel is TrackingPixel => pixel !== null);
	const trackingLinks = extractLinks(html)
		.map(analyzeLink)
		.filter((link): link is TrackingLink => link !== null);
	const trackingResources = extractRemoteResources(html)
		.map((resource) => analyzeResource(resource, globalCssReason))
		.filter((resource): resource is TrackingResource => resource !== null);

	return {
		remoteImageCount: images.length,
		trackingPixels,
		trackingLinks,
		trackingResources,
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
		url = normalizeUrl(url);
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
function analyzeImage(
	image: ExtractedImage,
	globalCssReason: string | null,
): TrackingPixel | null {
	const isOneByOne = image.width === 1 && image.height === 1;
	// Une image déjà 1×1 est signalée : inutile d'ajouter une raison CSS en plus.
	const hiddenReason = isOneByOne
		? null
		: (inlineCssHiddenReason(image.style) ?? globalCssReason);
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
	reasons.push(...urlTrackingReasons(image.url));

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

// --- Liens de suivi -----------------------------------------------------------

/** URLs des liens <a href> du message, dédupliquées. */
function extractLinks(html: string): string[] {
	const links = new Set<string>();
	for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
		const rawHref = getAttribute(match[0], "href");
		const href = rawHref === null ? null : normalizeUrl(rawHref);
		if (href !== null && isRemoteUrl(href)) {
			links.add(href);
		}
	}
	return [...links];
}

/**
 * Analyse un lien et renvoie un lien de suivi si au moins deux indices sont
 * réunis (ex. domaine de redirection + paramètre url=…). Un seul indice ne
 * suffit pas : utm_source seul est un usage marketing courant, pas une fuite.
 */
function analyzeLink(url: string): TrackingLink | null {
	const reasons: string[] = [];
	const path = parseUrl(url)?.pathname ?? "";

	// Chemin explicite de redirection : /click/…, /track/… (Mailchimp, SendGrid…).
	if (/(?:^|\/)(?:click|track|trk|redirect)\//i.test(path)) {
		reasons.push("Chemin de redirection");
	}
	if (hostContainsWord(url, CLICK_WORDS)) {
		reasons.push("Domaine de redirection");
	}
	const redirectParams = findUrlParams(url, REDIRECT_PARAMS);
	if (redirectParams.length > 0) {
		reasons.push(`Paramètre de redirection (${redirectParams.join(", ")})`);
	}
	// Paramètres de suivi partagés avec l'analyse des images.
	const trackingParams = findTrackingParams(url);
	if (trackingParams.length > 0) {
		reasons.push(`Paramètres de suivi (${trackingParams.join(", ")})`);
	}

	if (reasons.length < 2) return null;
	return { url, reasons };
}

// --- Ressources distantes non-image -------------------------------------------

/** Ressource distante extraite d'une balise non-image (iframe, link…). */
interface ExtractedResource {
	url: string;
	width: number | null;
	height: number | null;
	style: string | null;
}

/** Extrait les ressources distantes des balises non-image, dédupliquées. */
function extractRemoteResources(html: string): ExtractedResource[] {
	const resources: ExtractedResource[] = [];
	const seen = new Set<string>();

	for (const tagName of RESOURCE_TAGS) {
		for (const match of html.matchAll(
			new RegExp(`<${tagName}\\b[^>]*>`, "gi"),
		)) {
			const tag = match[0];
			const url = normalizeUrl(
				getAttribute(tag, "src") ?? getAttribute(tag, "href") ?? "",
			);
			if (!isRemoteUrl(url) || seen.has(url)) continue;
			seen.add(url);

			resources.push({
				url,
				width: parseDimension(getAttribute(tag, "width")),
				height: parseDimension(getAttribute(tag, "height")),
				style: getAttribute(tag, "style"),
			});
		}
	}
	return resources;
}

/**
 * Analyse une ressource et renvoie une ressource suspecte si elle semble
 * l'être (invisible ou avec au moins deux indices d'URL), sinon null.
 */
function analyzeResource(
	resource: ExtractedResource,
	globalCssReason: string | null,
): TrackingResource | null {
	const isOneByOne = resource.width === 1 && resource.height === 1;
	const hiddenReason = isOneByOne
		? null
		: (inlineCssHiddenReason(resource.style) ?? globalCssReason);
	const fileName = suspiciousFileName(resource.url);
	const reasons: string[] = [];

	if (isOneByOne) {
		reasons.push("Dimension 1×1 px");
	}
	if (hiddenReason !== null) {
		reasons.push(hiddenReason);
	}
	if (fileName !== null) {
		reasons.push(`Nom de fichier suspect (${fileName})`);
	}
	reasons.push(...urlTrackingReasons(resource.url));

	const isSuspicious =
		isOneByOne ||
		hiddenReason !== null ||
		fileName !== null ||
		reasons.length >= 2;
	if (!isSuspicious) return null;

	return {
		url: resource.url,
		width: resource.width,
		height: resource.height,
		reasons,
	};
}

// --- Helpers ---------------------------------------------------------------

/** Décode les séparateurs HTML courants sans interpréter le document ni charger de contenu. */
function normalizeUrl(url: string): string {
	return url.replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
}

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
 * Raison de signalement si le style CSS rend l'élément invisible, sinon null.
 * Renvoie le détail ("display: none", "opacity: 0"…) : l'appelant le met en
 * forme ("Masquée par CSS (…)", "Masquée par CSS global (…)"). Les trackers
 * ne font pas que du 1×1 : ils masquent aussi leurs pixels avec display: none,
 * une opacité nulle ou des dimensions CSS minuscules.
 */
function cssHiddenReason(style: string | null): string | null {
	if (style === null) return null;
	const css = style.toLowerCase();

	if (hasCssDeclaration(css, "display", "none")) {
		return "display: none";
	}
	if (hasCssDeclaration(css, "visibility", "hidden")) {
		return "visibility: hidden";
	}
	if (hasCssDeclaration(css, "opacity", "0(\\.0+)?")) {
		return "opacity: 0";
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

/** Raison de masquage d'un style inline (style="…"), sinon null. */
function inlineCssHiddenReason(style: string | null): string | null {
	const detail = cssHiddenReason(style);
	return detail === null ? null : `Masquée par CSS (${detail})`;
}

/**
 * Style global (<style>) qui masque les images (ex. img { display: none }),
 * sinon null. Les règles @media sont ignorées : cacher des éléments sur petit
 * écran est un usage responsive légitime des newsletters.
 */
function findGlobalCssHiding(html: string): string | null {
	for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
		const css = stripMediaQueries(match[1] ?? "");

		for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const selector = rule[1] ?? "";
			// La règle doit cibler les images ou iframes (img, table img…).
			if (!/\b(?:img|iframe)\b/i.test(selector)) continue;

			const detail = cssHiddenReason(rule[2] ?? null);
			if (detail !== null) {
				return `Masquée par CSS global (${detail})`;
			}
		}
	}
	return null;
}

/**
 * Retire les blocs @media (…){…} du CSS. Les accolades des règles internes
 * sont comptées pour trouver la fin du bloc.
 */
function stripMediaQueries(css: string): string {
	let result = "";
	let depth = 0;

	for (let i = 0; i < css.length; i++) {
		if (depth > 0) {
			const char = css[i];
			if (char === "{") depth++;
			else if (char === "}") depth--;
			continue;
		}

		const mediaStart = css.indexOf("@media", i);
		if (mediaStart === -1) {
			return result + css.slice(i);
		}

		result += css.slice(i, mediaStart);
		const openBrace = css.indexOf("{", mediaStart);
		if (openBrace === -1) return result;
		depth = 1;
		i = openBrace;
	}

	return result;
}

/** true si le style contient `propriété: valeur` (suivi de ; ! ou de la fin). */
function hasCssDeclaration(
	style: string,
	property: string,
	value: string,
): boolean {
	return new RegExp(
		`(?:^|;)\\s*${property}\\s*:\\s*${value}\\s*(?:[;!]|$)`,
	).test(style);
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

/** true si le domaine de l'URL contient un mot-clé (click.example.com…). */
function hostContainsWord(url: string, words: string[]): boolean {
	const parsed = parseUrl(url);
	return (
		parsed !== null &&
		words.some((word) => parsed.hostname.toLowerCase().includes(word))
	);
}

/** true si le domaine ou le chemin de l'URL contient un mot-clé de suivi. */
function urlContainsWord(url: string, words: string[]): boolean {
	const parsed = parseUrl(url);
	if (parsed === null) return false;

	const hostAndPath = `${parsed.hostname} ${parsed.pathname}`;
	return words.some((word) => hostAndPath.toLowerCase().includes(word));
}

/**
 * Indices de suivi présents dans une URL : mot-clé du domaine/chemin et
 * paramètres de suivi. Partagé par les images et les liens.
 */
function urlTrackingReasons(url: string): string[] {
	const reasons: string[] = [];
	if (urlContainsWord(url, TRACKING_WORDS)) {
		reasons.push("Domaine ou chemin lié au suivi");
	}
	const trackingParams = findTrackingParams(url);
	if (trackingParams.length > 0) {
		reasons.push(`Paramètres de suivi (${trackingParams.join(", ")})`);
	}
	return reasons;
}

/** Paramètres de l'URL dont le nom est dans la liste fournie. */
function findUrlParams(url: string, names: string[]): string[] {
	const parsed = parseUrl(url);
	if (parsed === null) return [];

	return [...parsed.searchParams.keys()].filter((name) =>
		names.includes(name.toLowerCase()),
	);
}

/** Paramètres de l'URL reconnus comme liés au suivi. */
function findTrackingParams(url: string): string[] {
	return findUrlParams(url, TRACKING_PARAMS);
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

// --- Accusés de réception -----------------------------------------------------

// En-têtes demandant un accusé de réception : le client mail (ex. Outlook)
// renvoie une confirmation d'ouverture à l'expéditeur, sans aucun HTML. C'est
// une forme de suivi sans pixel.
const READ_RECEIPT_HEADERS = [
	"return-receipt-to",
	"disposition-notification-to",
];

/**
 * true si le message demande un accusé de réception (Return-Receipt-To ou
 * Disposition-Notification-To), ce qui confirme son ouverture à l'expéditeur.
 */
export function readReceiptRequested(part: ThunderbirdMessagePart): boolean {
	const headers = part.headers ?? {};
	return Object.entries(headers).some(
		([name, values]) =>
			READ_RECEIPT_HEADERS.includes(name.toLowerCase()) && values.length > 0,
	);
}
