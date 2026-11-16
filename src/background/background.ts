// src/background/background.ts
import {
	type AnalysisResult,
	detectTrackingThreats,
	findHtmlBody,
	readReceiptRequested,
} from "../lib/detector";

type PopupMessage = {
	type: "ANALYZE_CURRENT_MESSAGE";
};

/**
 * Résultat de l'analyse avec l'onglet de messagerie concerné.
 * L'onglet est nécessaire pour mettre à jour le bouton d'en-tête
 * du message (messageDisplayAction) pour le bon onglet.
 */
type AnalysisContext = {
	mailTab?: ThunderbirdMailTab;
	result: AnalysisResult;
};

console.info("Thunderbird Pixel Detector démarré");

messenger.runtime.onInstalled.addListener(() => {
	console.info("Thunderbird Pixel Detector installé ou mis à jour");
});

messenger.runtime.onMessage.addListener((message: PopupMessage) => {
	if (message.type !== "ANALYZE_CURRENT_MESSAGE") {
		return undefined;
	}

	// La Promise renvoyée sert de réponse au popup (runtime.sendMessage).
	return analyzeCurrentMessage();
});

// Analyse automatique à chaque affichage d'un message, pour mettre à jour
// les indicateurs sans action de l'utilisateur.
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const generations = new Map<number, number>();
const badgeUpdates = new Map<number, Promise<void>>();

function nextGeneration(tabId: number): number {
	const generation = (generations.get(tabId) ?? 0) + 1;
	generations.set(tabId, generation);
	return generation;
}

messenger.messageDisplay.onMessagesDisplayed.addListener(
	(tab, displayedMessages) => {
		const generation = nextGeneration(tab.tabId);
		clearTimeout(timers.get(tab.tabId));
		timers.set(
			tab.tabId,
			setTimeout(() => {
				timers.delete(tab.tabId);
				void analyzeMessage(tab, displayedMessages.messages)
					.then((context) => analyzeAndUpdateBadge(context, generation))
					.catch((error) => {
						console.error("Échec de l'analyse automatique", error);
					});
			}, 300),
		);
	},
);

/**
 * Analyse le message affiché puis met à jour les indicateurs.
 * Renvoie le résultat pour que le popup puisse l'afficher.
 */
async function analyzeAndUpdateBadge(
	context: AnalysisContext,
	generation: number,
): Promise<AnalysisResult> {
	const tabId = context.mailTab?.tabId;
	if (tabId === undefined) return context.result;
	const previous = badgeUpdates.get(tabId) ?? Promise.resolve();
	const update = previous
		.catch(() => {})
		.then(async () => {
			if (generations.get(tabId) === generation) await updateBadge(context);
		});
	badgeUpdates.set(tabId, update);
	try {
		await update;
	} finally {
		if (badgeUpdates.get(tabId) === update) badgeUpdates.delete(tabId);
	}
	return generations.get(tabId) === generation
		? context.result
		: emptyResult("Le message affiché a changé. Veuillez réanalyser.");
}

/**
 * Récupère le message affiché dans l'onglet de messagerie courant.
 * Utilisé par le popup, qui n'a pas accès à l'événement onMessagesDisplayed.
 */
async function analyzeCurrentMessage(): Promise<AnalysisResult> {
	const [mailTab] = await messenger.mailTabs.query({
		active: true,
		currentWindow: true,
	});

	if (mailTab === undefined) {
		return emptyResult("Aucun onglet de messagerie ouvert.");
	}

	const generation = nextGeneration(mailTab.tabId);
	clearTimeout(timers.get(mailTab.tabId));
	timers.delete(mailTab.tabId);
	let context: AnalysisContext;
	try {
		const { messages } = await messenger.messageDisplay.getDisplayedMessages(
			mailTab.tabId,
		);
		context = await analyzeMessage(mailTab, messages);
	} catch (error) {
		console.error("Échec de l'analyse", error);
		context = {
			mailTab,
			result: emptyResult("Erreur pendant l'analyse du message."),
		};
	}
	return analyzeAndUpdateBadge(context, generation);
}

/**
 * Analyse le contenu HTML d'un message affiché.
 * Détection pure : aucun contenu distant n'est chargé.
 */
async function analyzeMessage(
	mailTab: ThunderbirdMailTab,
	headers: ThunderbirdMessageHeader[],
): Promise<AnalysisContext> {
	const header = headers[0];
	if (header === undefined) {
		return { mailTab, result: emptyResult("Aucun message affiché.") };
	}

	let message: ThunderbirdMessagePart;
	try {
		message = await messenger.messages.getFull(header.id);
	} catch (error) {
		console.error("Échec de la lecture du message", error);
		return {
			mailTab,
			result: emptyResult("Erreur pendant l'analyse du message."),
		};
	}
	const html = findHtmlBody(message) ?? "";
	return {
		mailTab,
		result: {
			...detectTrackingThreats(html),
			// Les en-têtes MIME (accusés de réception) ne sont pas dans le HTML.
			readReceiptRequested: readReceiptRequested(message),
			multipleMessages: headers.length > 1,
		},
	};
}

/** Résultat vide accompagné d'un message d'erreur. */
function emptyResult(error: string): AnalysisResult {
	return {
		remoteImageCount: 0,
		trackingPixels: [],
		trackingLinks: [],
		trackingResources: [],
		error,
	};
}

/**
 * Met à jour les indicateurs visibles :
 * - le badge de l'icône de l'extension (barre d'outils) ;
 * - le bouton d'en-tête du message affiché (messageDisplayAction).
 */
async function updateBadge(context: AnalysisContext): Promise<void> {
	const { result, mailTab } = context;
	const count =
		result.trackingPixels.length +
		result.trackingLinks.length +
		result.trackingResources.length;
	// Un accusé de réception mérite aussi l'attention : c'est une confirmation
	// d'ouverture sans pixel.
	const needsAttention = count > 0 || result.readReceiptRequested === true;

	// Badge de l'icône : rouge avec le nombre de menaces, sinon rien.
	const badgeText = count > 0 ? String(count) : "";
	await messenger.action.setBadgeText({
		tabId: mailTab?.tabId,
		text: badgeText,
	});
	if (count > 0) {
		await messenger.action.setBadgeBackgroundColor({
			tabId: mailTab?.tabId,
			color: "#d32f2f",
		});
	}

	// Sans onglet ou sans analyse, il n'y a rien à indiquer sur l'en-tête.
	if (mailTab === undefined) {
		return;
	}
	if (result.error !== undefined) {
		await messenger.messageDisplayAction.setBadgeText({
			tabId: mailTab.tabId,
			text: "",
		});
		await messenger.messageDisplayAction.setLabel({
			tabId: mailTab.tabId,
			label: "Analyse indisponible",
		});
		await messenger.messageDisplayAction.setTitle({
			tabId: mailTab.tabId,
			title: result.error,
		});
		return;
	}

	// Bouton d'en-tête du message : badge vert « 0 » si le message est sûr,
	// rouge avec le nombre de menaces sinon. Le label précise l'état.
	const { tabId } = mailTab;
	await messenger.messageDisplayAction.setBadgeText({
		tabId,
		text: String(count),
	});
	await messenger.messageDisplayAction.setBadgeBackgroundColor({
		tabId,
		color: needsAttention ? "#d32f2f" : "#2e7d32",
	});
	await messenger.messageDisplayAction.setLabel({
		tabId,
		label:
			count > 0
				? `${count} menace(s)`
				: result.readReceiptRequested
					? "Accusé de réception"
					: "Aucun suivi détecté",
	});
	await messenger.messageDisplayAction.setTitle({
		tabId,
		title:
			count > 0
				? `${count} menace(s) de suivi détectée(s). Cliquez pour le détail.`
				: result.readReceiptRequested
					? "Ce message demande un accusé de réception : l'ouverture peut être confirmée à l'expéditeur."
					: "Aucun pixel de suivi détecté. Cliquez pour le détail.",
	});
}
