type ExtensionMessage = {
	type: "ANALYZE_CURRENT_MESSAGE";
};

type ExtensionResponse = {
	message: string;
};

console.info("Thunderbird Pixel Detector démarré");

messenger.runtime.onInstalled.addListener(() => {
	console.info("Thunderbird Pixel Detector installé ou mis à jour");
});

messenger.runtime.onMessage.addListener(
	(
		message: ExtensionMessage,
		_sender,
		sendResponse: (response: ExtensionResponse) => void,
	) => {
		if (message.type !== "ANALYZE_CURRENT_MESSAGE") {
			return false;
		}

		console.info("Demande d'analyse reçue");

		sendResponse({
			message: "Le système de communication fonctionne.",
		});

		return false;
	},
);
