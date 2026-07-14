import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
	throw new Error("Élément #app introuvable");
}

app.innerHTML = `
  <header>
    <h1>Pixel Detector</h1>
    <p id="status">Extension chargée.</p>
  </header>

  <button id="analyze-button" type="button">
    Analyser le message
  </button>
`;

const analyzeButton =
	document.querySelector<HTMLButtonElement>("#analyze-button");

const status = document.querySelector<HTMLParagraphElement>("#status");

analyzeButton?.addEventListener("click", async () => {
	if (!status) {
		return;
	}

	try {
		status.textContent = "Analyse en cours…";

		const response = await messenger.runtime.sendMessage({
			type: "ANALYZE_CURRENT_MESSAGE",
		});

		status.textContent =
			response?.message ?? "Demande transmise au service d’analyse.";
	} catch (error) {
		console.error(error);
		status.textContent = "Erreur pendant l’analyse.";
	}
});
