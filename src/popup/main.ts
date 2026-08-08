// src/popup/main.ts
import "./style.css";

import type { AnalysisResult } from "../lib/detector";

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

	const { trackingPixels, trackingLinks, remoteImageCount } = result;
	const totalThreats = trackingPixels.length + trackingLinks.length;
	status.textContent =
		totalThreats === 0
			? "Aucun pixel de suivi détecté."
			: `${totalThreats} menace(s) de suivi détectée(s) sur ${remoteImageCount} image(s) distante(s).`;

	results.hidden = false;
	if (totalThreats === 0) {
		results.innerHTML = `<p class="ok">Ce message semble exempt de pixel de suivi.</p>`;
		return;
	}

	const sections: string[] = [];
	if (trackingPixels.length > 0) {
		sections.push(
			renderSection(
				"Pixels de suivi",
				trackingPixels.map((pixel) =>
					renderThreatItem(
						pixel.url,
						`Dimensions : ${pixel.width ?? "?"}×${pixel.height ?? "?"} px`,
						pixel.reasons,
					),
				),
			),
		);
	}
	if (trackingLinks.length > 0) {
		sections.push(
			renderSection(
				"Liens de suivi des clics",
				trackingLinks.map((link) =>
					renderThreatItem(link.url, "", link.reasons),
				),
			),
		);
	}
	results.innerHTML = sections.join("");
}

function renderSection(title: string, items: string[]): string {
	return `<section class="threats"><h3>${escapeHtml(title)}</h3>${items.join("")}</section>`;
}

function renderThreatItem(
	url: string,
	meta: string,
	reasons: string[],
): string {
	const metaHtml = meta === "" ? "" : `<p class="meta">${escapeHtml(meta)}</p>`;
	const reasonsHtml = reasons
		.map((reason) => `<li>${escapeHtml(reason)}</li>`)
		.join("");

	return `<article class="pixel"><h2>${escapeHtml(url)}</h2>${metaHtml}<ul>${reasonsHtml}</ul></article>`;
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
