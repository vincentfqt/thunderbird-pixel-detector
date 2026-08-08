// src/popup/main.ts
import "./style.css";

import type { AnalysisResult, TrackingPixel } from "../lib/detector";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
	throw new Error("Élément #app introuvable");
}

app.innerHTML = `
  <header>
    <h1>Pixel Detector</h1>
    <p id="status">Analyse…</p>
  </header>

  <button id="analyze-button" type="button">Réanalyser</button>

  <section id="results" hidden></section>
`;

const analyzeButton =
	document.querySelector<HTMLButtonElement>("#analyze-button");
const status = document.querySelector<HTMLParagraphElement>("#status");
const results = document.querySelector<HTMLElement>("#results");

// Analyse dès l'ouverture du popup.
void runAnalysis();

analyzeButton?.addEventListener("click", () => {
	void runAnalysis();
});

async function runAnalysis(): Promise<void> {
	if (!status || !results) return;

	status.textContent = "Analyse en cours…";

	try {
		const response = (await messenger.runtime.sendMessage({
			type: "ANALYZE_CURRENT_MESSAGE",
		})) as AnalysisResult | undefined;

		if (response === undefined) {
			status.textContent = "Aucune réponse du service d'analyse.";
			return;
		}

		render(response);
	} catch (error) {
		console.error(error);
		status.textContent = "Erreur pendant l'analyse.";
	}
}

function render(result: AnalysisResult): void {
	if (!status || !results) return;

	if (result.error !== undefined) {
		status.textContent = result.error;
		results.hidden = true;
		return;
	}

	const { trackingPixels, remoteImageCount } = result;
	status.textContent =
		trackingPixels.length === 0
			? "Aucun pixel de suivi détecté."
			: `${trackingPixels.length} pixel(s) de suivi détecté(s) sur ${remoteImageCount} image(s) distante(s).`;

	results.hidden = false;
	results.innerHTML =
		trackingPixels.length === 0
			? `<p class="ok">Ce message semble exempt de pixel de suivi.</p>`
			: trackingPixels.map(renderPixel).join("");
}

function renderPixel(pixel: TrackingPixel): string {
	const dimensions =
		pixel.width === null && pixel.height === null
			? ""
			: `<p class="meta">Dimensions : ${pixel.width ?? "?"}×${pixel.height ?? "?"} px</p>`;

	const reasons = pixel.reasons
		.map((reason) => `<li>${escapeHtml(reason)}</li>`)
		.join("");

	return `
		<article class="pixel">
			<h2>${escapeHtml(pixel.url)}</h2>
			${dimensions}
			<ul>${reasons}</ul>
		</article>
	`;
}

/** Échappe le HTML : les URLs viennent d'emails potentiellement hostiles. */
function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
