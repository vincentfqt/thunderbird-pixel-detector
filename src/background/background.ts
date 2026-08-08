// src/background/background.ts
import {
	type AnalysisResult,
	detectTrackingPixels,
	findHtmlBody,
} from "../lib/detector";

type PopupMessage = {
	type: "ANALYZE_CURRENT_MESSAGE";
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
	return analyzeAndUpdateBadge();
});

// Analyse automatique à chaque affichage d'un message, pour mettre à jour
// le badge de l'icône sans action de l'utilisateur.
let autoAnalyzeTimer: ReturnType<typeof setTimeout> | undefined;

messenger.messageDisplay.onMessageDisplayed.addListener(() => {
	if (autoAnalyzeTimer !== undefined) {
		clearTimeout(autoAnalyzeTimer);
	}

	autoAnalyzeTimer = setTimeout(() => {
		void analyzeAndUpdateBadge().catch((error) => {
			console.error("Échec de l'analyse automatique", error);
		});
	}, 300);
});

/** Analyse le message affiché puis met à jour le badge. */
async function analyzeAndUpdateBadge(): Promise<AnalysisResult> {
	const result = await analyzeDisplayedMessage();
	await updateBadge(result);
	return result;
}

/** Récupère le message affiché et détecte ses pixels de suivi. */
async function analyzeDisplayedMessage(): Promise<AnalysisResult> {
	const tab = await messenger.mailTabs.getCurrent();
	const header = await messenger.messageDisplay.getDisplayedMessage(tab.id);

	if (header === null) {
		return {
			remoteImageCount: 0,
			trackingPixels: [],
			error: "Aucun message affiché.",
		};
	}

	const message = await messenger.messages.getFull(header.id);
	const html = findHtmlBody(message) ?? "";
	return detectTrackingPixels(html);
}

/** Affiche le nombre de pixels détectés sur l'icône de l'extension. */
async function updateBadge(result: AnalysisResult): Promise<void> {
	const count = result.trackingPixels.length;

	await messenger.action.setBadgeText({
		text: count > 0 ? String(count) : "",
	});

	if (count > 0) {
		await messenger.action.setBadgeBackgroundColor({ color: "#d32f2f" });
	}
}
