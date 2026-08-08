// src/lib/detector.test.ts
import { describe, expect, it } from "vitest";
import { detectTrackingPixels, findHtmlBody } from "./detector";

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

	it("analyse un email de newsletter réaliste et n'y signale que le pixel", () => {
		const html = `
			<!doctype html>
			<html>
			<body>
				<table>
					<tr>
						<td><img src="https://cdn.newsletter.fr/img/logo-newsletter.png" width="120" height="40" alt="Logo"></td>
					</tr>
					<tr>
						<td>
							<p>Bonjour, voici nos offres de la semaine…</p>
							<a href="https://www.example.com/shop">
								<img src="https://www.example.com/banners/promo-ete.jpg" width="600" height="200" alt="Promo">
							</a>
						</td>
					</tr>
					<tr>
						<td style="background-image:url('https://img.newsletter.fr/fond.png');">&nbsp;</td>
					</tr>
				</table>
				<img src="https://track.newsletter.fr/open?mid=abc123XYZ456&email=user@example.com" width="1" height="1" alt="">
				<img src="cid:signature.png" alt="">
			</body>
			</html>
		`;

		const { remoteImageCount, trackingPixels } = detectTrackingPixels(html);

		expect(remoteImageCount).toBe(4);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].url).toBe(
			"https://track.newsletter.fr/open?mid=abc123XYZ456&email=user@example.com",
		);
		expect(trackingPixels[0].reasons).toEqual([
			"Image de 1×1 px",
			"Nom de fichier suspect (open)",
			"Domaine ou chemin lié au suivi",
			"Paramètres de suivi (mid, email)",
		]);
	});

	it("détecte une image masquée par CSS (display: none)", () => {
		const html = `<img src="https://tracker.example.com/px.gif" style="display:none" alt="">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain(
			"Masquée par CSS (display: none)",
		);
	});

	it("détecte un pixel 1×1 déclaré uniquement dans le style", () => {
		const html =
			`<img src="https://tracker.example.com/px.gif" ` +
			`style="width:1px;height:1px" alt="">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain("Dimensions CSS minuscules");
	});

	it("détecte une image invisible via opacity: 0", () => {
		const html = `<img src="https://tracker.example.com/px.gif" style="opacity:0" alt="">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain("Masquée par CSS (opacity: 0)");
	});

	it("ne signale pas une image stylée mais visible", () => {
		const html =
			`<img src="https://cdn.legitime.fr/img/photo.jpg" ` +
			`style="border-radius:8px;width:300px" alt="Photo">`;

		const { trackingPixels } = detectTrackingPixels(html);
		expect(trackingPixels).toHaveLength(0);
	});

	it("extrait les images à chargement différé (data-src)", () => {
		const html = `<img data-src="https://img.newsletter.fr/logo-mobile.png" alt="Logo">`;

		const { remoteImageCount, trackingPixels } = detectTrackingPixels(html);
		expect(remoteImageCount).toBe(1);
		expect(trackingPixels).toHaveLength(0);
	});

	it("détecte un pixel déclaré dans srcset", () => {
		const html =
			`<img src="https://cdn.newsletter.fr/img/banner.jpg" ` +
			`srcset="https://tracker.example.com/px.gif 1x" alt="Bannière">`;

		const { remoteImageCount, trackingPixels } = detectTrackingPixels(html);
		expect(remoteImageCount).toBe(2);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].url).toBe("https://tracker.example.com/px.gif");
	});
});

describe("findHtmlBody", () => {
	it("renvoie le corps d'un message HTML simple", () => {
		const part = { contentType: "text/html", body: "<p>Bonjour</p>" };
		expect(findHtmlBody(part)).toBe("<p>Bonjour</p>");
	});

	it("trouve la partie HTML dans un multipart/alternative", () => {
		const part = {
			contentType: "multipart/alternative",
			parts: [
				{ contentType: "text/plain", body: "Bonjour" },
				{ contentType: "text/html", body: "<p>Bonjour</p>" },
			],
		};
		expect(findHtmlBody(part)).toBe("<p>Bonjour</p>");
	});

	it("trouve la partie HTML imbriquée dans un multipart/mixed", () => {
		const part = {
			contentType: "multipart/mixed",
			parts: [
				{
					contentType: "multipart/alternative",
					parts: [
						{ contentType: "text/plain", body: "Bonjour" },
						{ contentType: "text/html", body: "<p>Imbriqué</p>" },
					],
				},
				{ contentType: "application/pdf", body: "pdf-binaire" },
			],
		};
		expect(findHtmlBody(part)).toBe("<p>Imbriqué</p>");
	});

	it("renvoie null si le message n'a pas de partie HTML", () => {
		const part = { contentType: "text/plain", body: "Bonjour" };
		expect(findHtmlBody(part)).toBeNull();
	});

	it("renvoie null pour une partie HTML sans corps", () => {
		const part = { contentType: "text/html", body: null };
		expect(findHtmlBody(part)).toBeNull();
	});
});
