// src/lib/detector.test.ts
import { describe, expect, it } from "vitest";
import { detectTrackingPixels } from "./detector";

describe("detectTrackingPixels", () => {
	it("détecte un pixel de suivi classique (1×1 + nom de fichier)", () => {
		const html =
			`<img src="https://track.newsletter.com/open/pixel.gif?open_id=abc123" ` +
			`width="1" height="1" alt="">`;

		const { remoteImageCount, trackingPixels } = detectTrackingPixels(html);

		expect(remoteImageCount).toBe(1);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain("Image de 1×1 px");
	});

	it("détecte un pixel via une image de fond CSS", () => {
		const html = `<div style="background-image: url('https://beacon.example.net/open.gif');"></div>`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(1);
	});

	it("détecte un pixel avec paramètres de suivi sur un domaine suspect", () => {
		const html =
			`<img src="https://www.example.com/track?id=123&campaign=news" ` +
			`width="1" height="1">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(1);
	});

	it("ne signale pas une image légitime", () => {
		const html =
			`<img src="https://cdn.legitime.fr/img/logo-entreprise.png" ` +
			`width="300" height="80" alt="Logo">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(0);
	});

	it("ignore les images embarquées (cid: et data:)", () => {
		const html = `
			<img src="cid:logo@example.com" alt="logo">
			<img src="data:image/png;base64,iVBORw0KGgo=" alt="pixel">
		`;

		const { remoteImageCount, trackingPixels } = detectTrackingPixels(html);
		expect(remoteImageCount).toBe(0);
		expect(trackingPixels).toHaveLength(0);
	});

	it("ne signale rien sur un corps sans HTML", () => {
		const html = "Bonjour, veuillez trouver ci-joint le document.";
		expect(detectTrackingPixels(html).remoteImageCount).toBe(0);
	});
});
