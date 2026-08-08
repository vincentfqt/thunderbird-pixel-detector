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
	return analyzeCurrentMessage().then(analyzeAndUpdateBadge);
});

// Analyse automatique à chaque affichage d'un message, pour mettre à jour
// les indicateurs sans action de l'utilisateur.
let autoAnalyzeTimer: ReturnType<typeof setTimeout> | undefined;

messenger.messageDisplay.onMessagesDisplayed.addListener(
	(tab, displayedMessages) => {
		if (autoAnalyzeTimer !== undefined) {
			clearTimeout(autoAnalyzeTimer);
		}

		autoAnalyzeTimer = setTimeout(() => {
			void analyzeMessage(tab, displayedMessages.messages[0])
				.then(analyzeAndUpdateBadge)
				.catch((error) => {
					console.error("Échec de l'analyse automatique", error);
				});
		}, 300);
	},
);

/**
 * Analyse le message affiché puis met à jour les indicateurs.
 * Renvoie le résultat pour que le popup puisse l'afficher.
 */
async function analyzeAndUpdateBadge(
	context: AnalysisContext,
): Promise<AnalysisResult> {
	await updateBadge(context);
	return context.result;
}

/**
 * Récupère le message affiché dans l'onglet de messagerie courant.
 * Utilisé par le popup, qui n'a pas accès à l'événement onMessagesDisplayed.
 */
async function analyzeCurrentMessage(): Promise<AnalysisContext> {
	const [mailTab] = await messenger.mailTabs.query({
		active: true,
		currentWindow: true,
	});

	if (mailTab === undefined) {
		return { result: emptyResult("Aucun onglet de messagerie ouvert.") };
	}

	const { messages } = await messenger.messageDisplay.getDisplayedMessages(
		mailTab.tabId,
	);
	return analyzeMessage(mailTab, messages[0]);
}

/**
 * Analyse le contenu HTML d'un message affiché.
 * Détection pure : aucun contenu distant n'est chargé.
 */
async function analyzeMessage(
	mailTab: ThunderbirdMailTab,
	header: ThunderbirdMessageHeader | undefined,
): Promise<AnalysisContext> {
	if (header === undefined) {
		return { mailTab, result: emptyResult("Aucun message affiché.") };
	}

	const message = await messenger.messages.getFull(header.id);
	const html = findHtmlBody(message) ?? "";
	return {
		mailTab,
		result: {
			...detectTrackingThreats(html),
			// Les en-têtes MIME (accusés de réception) ne sont pas dans le HTML.
			readReceiptRequested: readReceiptRequested(message),
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
	await messenger.action.setBadgeText({ text: badgeText });
	if (count > 0) {
		await messenger.action.setBadgeBackgroundColor({ color: "#d32f2f" });
	}

	// Sans onglet ou sans analyse, il n'y a rien à indiquer sur l'en-tête.
	if (mailTab === undefined || result.error !== undefined) {
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
					: "Sûr",
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
