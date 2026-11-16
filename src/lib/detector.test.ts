// src/lib/detector.test.ts
import { describe, expect, it } from "vitest";
import {
	detectTrackingThreats,
	findHtmlBody,
	readReceiptRequested,
} from "./detector";

describe("detectTrackingThreats", () => {
	it("décode les séparateurs HTML dans les URL avant l'analyse", () => {
		const result = detectTrackingThreats(
			'<a href="https://example.com/page?x=1&amp;url=https%3A%2F%2Fexample.org&amp;mid=1">lien</a>',
		);
		expect(result.trackingLinks).toHaveLength(1);
		expect(result.trackingLinks[0]?.url).toContain("&url=");
	});

	it("ne signale pas un lien légitime avec un séparateur encodé", () => {
		const result = detectTrackingThreats(
			'<a href="https://example.com/?x=1&amp;utm_source=news">lien</a>',
		);
		expect(result.trackingLinks).toHaveLength(0);
	});
	it("détecte un pixel de suivi classique (1×1 + nom de fichier)", () => {
		const html =
			`<img src="https://track.newsletter.com/open/pixel.gif?open_id=abc123" ` +
			`width="1" height="1" alt="">`;

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);

		expect(remoteImageCount).toBe(1);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain("Image de 1×1 px");
	});

	it("détecte un pixel via une image de fond CSS", () => {
		const html = `<div style="background-image: url('https://beacon.example.net/open.gif');"></div>`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
	});

	it("détecte un pixel avec paramètres de suivi sur un domaine suspect", () => {
		const html =
			`<img src="https://www.example.com/track?id=123&campaign=news" ` +
			`width="1" height="1">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
	});

	it("ne signale pas une image légitime", () => {
		const html =
			`<img src="https://cdn.legitime.fr/img/logo-entreprise.png" ` +
			`width="300" height="80" alt="Logo">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(0);
	});

	it("ignore les images embarquées (cid: et data:)", () => {
		const html = `
			<img src="cid:logo@example.com" alt="logo">
			<img src="data:image/png;base64,iVBORw0KGgo=" alt="pixel">
		`;

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);
		expect(remoteImageCount).toBe(0);
		expect(trackingPixels).toHaveLength(0);
	});

	it("ne signale rien sur un corps sans HTML", () => {
		const html = "Bonjour, veuillez trouver ci-joint le document.";
		expect(detectTrackingThreats(html).remoteImageCount).toBe(0);
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

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);

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

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain(
			"Masquée par CSS (display: none)",
		);
	});

	it("détecte un pixel 1×1 déclaré uniquement dans le style", () => {
		const html =
			`<img src="https://tracker.example.com/px.gif" ` +
			`style="width:1px;height:1px" alt="">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain(
			"Masquée par CSS (Dimensions CSS minuscules)",
		);
	});

	it("détecte une image invisible via opacity: 0", () => {
		const html = `<img src="https://tracker.example.com/px.gif" style="opacity:0" alt="">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain("Masquée par CSS (opacity: 0)");
	});

	it("ne signale pas une image stylée mais visible", () => {
		const html =
			`<img src="https://cdn.legitime.fr/img/photo.jpg" ` +
			`style="border-radius:8px;width:300px" alt="Photo">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(0);
	});

	it("extrait les images à chargement différé (data-src)", () => {
		const html = `<img data-src="https://img.newsletter.fr/logo-mobile.png" alt="Logo">`;

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);
		expect(remoteImageCount).toBe(1);
		expect(trackingPixels).toHaveLength(0);
	});

	it("détecte un pixel déclaré dans srcset", () => {
		const html =
			`<img src="https://cdn.newsletter.fr/img/banner.jpg" ` +
			`srcset="https://tracker.example.com/px.gif 1x" alt="Bannière">`;

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);
		expect(remoteImageCount).toBe(2);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].url).toBe("https://tracker.example.com/px.gif");
	});

	it("détecte un pixel en URL protocole-relative (//cdn…)", () => {
		const html = `<img src="//tracker.example.com/px.gif" width="1" height="1" alt="">`;

		const { remoteImageCount, trackingPixels } = detectTrackingThreats(html);
		expect(remoteImageCount).toBe(1);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].url).toBe("//tracker.example.com/px.gif");
	});

	it("ne signale pas une image légitime en URL protocole-relative", () => {
		const html =
			`<img src="//cdn.legitime.fr/img/logo.png" width="300" height="80" ` +
			`alt="Logo">`;

		expect(detectTrackingThreats(html).trackingPixels).toHaveLength(0);
	});

	it("détecte une image masquée par un style global (<style>img{display:none})", () => {
		const html =
			`<style>img { display: none }</style>` +
			`<img src="https://example.com/photo.png" alt="Photo">`;

		const { trackingPixels } = detectTrackingThreats(html);
		expect(trackingPixels).toHaveLength(1);
		expect(trackingPixels[0].reasons).toContain(
			"Masquée par CSS global (display: none)",
		);
	});

	it("ignore les règles @media : masquer des éléments sur mobile est légitime", () => {
		const html =
			`<style>@media (max-width: 600px) { img { display: none } }</style>` +
			`<img src="https://cdn.legitime.fr/img/logo.png" width="300" ` +
			`height="80" alt="Logo">`;

		expect(detectTrackingThreats(html).trackingPixels).toHaveLength(0);
	});

	it("ne signale pas une image quand le style global ne la masque pas", () => {
		const html =
			`<style>img { border-radius: 8px }</style>` +
			`<img src="https://cdn.legitime.fr/img/logo.png" width="300" ` +
			`height="80" alt="Logo">`;

		expect(detectTrackingThreats(html).trackingPixels).toHaveLength(0);
	});

	it("détecte un lien de suivi des clics (domaine de redirection + paramètre url)", () => {
		const html =
			`<a href="https://click.example.com/?url=https%3A%2F%2Fshop.com%2Fitem">` +
			`Voir l'offre</a>`;

		const { trackingLinks } = detectTrackingThreats(html);
		expect(trackingLinks).toHaveLength(1);
		expect(trackingLinks[0].url).toBe(
			"https://click.example.com/?url=https%3A%2F%2Fshop.com%2Fitem",
		);
		expect(trackingLinks[0].reasons).toEqual([
			"Domaine de redirection",
			"Paramètre de redirection (url)",
		]);
	});

	it("détecte un lien au chemin de redirection (/track/click/…)", () => {
		const html = `<a href="https://mailer.example.com/track/click?p=abc123">Offre</a>`;

		const { trackingLinks } = detectTrackingThreats(html);
		expect(trackingLinks).toHaveLength(1);
		expect(trackingLinks[0].reasons).toContain("Chemin de redirection");
	});

	it("ne signale pas un lien légitime avec un simple paramètre utm", () => {
		const html = `<a href="https://www.example.com/shop?utm_source=newsletter">Boutique</a>`;

		expect(detectTrackingThreats(html).trackingLinks).toHaveLength(0);
	});

	it("ne signale pas un lien de contenu mentionnant le mot « tracking »", () => {
		const html =
			`<a href="https://en.wikipedia.org/wiki/Tracking_pixel?utm_source=email">` +
			`Wikipédia</a>`;

		expect(detectTrackingThreats(html).trackingLinks).toHaveLength(0);
	});

	it("détecte un iframe de suivi (domaine + paramètres)", () => {
		const html = `<iframe src="https://track.example.com/frame?open=1" width="300" height="150"></iframe>`;

		const { trackingResources } = detectTrackingThreats(html);
		expect(trackingResources).toHaveLength(1);
		expect(trackingResources[0].reasons).toEqual([
			"Domaine ou chemin lié au suivi",
			"Paramètres de suivi (open)",
		]);
	});

	it("détecte un iframe 1×1 (beacon non-image)", () => {
		const html =
			`<iframe src="https://embed.example.com/player" width="1" ` +
			`height="1"></iframe>`;

		const { trackingResources } = detectTrackingThreats(html);
		expect(trackingResources).toHaveLength(1);
		expect(trackingResources[0].reasons).toContain("Dimension 1×1 px");
	});

	it("détecte un embed au nom de fichier typique de pixel", () => {
		const html = `<embed src="https://tracker.example.com/open.gif">`;

		const { trackingResources } = detectTrackingThreats(html);
		expect(trackingResources).toHaveLength(1);
		expect(trackingResources[0].reasons).toContain(
			"Nom de fichier suspect (open.gif)",
		);
	});

	it("ne signale pas une feuille de style légitime", () => {
		const html =
			`<link href="https://cdn.example.com/styles/main.css" ` +
			`rel="stylesheet">`;

		expect(detectTrackingThreats(html).trackingResources).toHaveLength(0);
	});
});

describe("readReceiptRequested", () => {
	it("détecte l'en-tête Return-Receipt-To", () => {
		const part = {
			contentType: "text/html",
			body: "<p>Bonjour</p>",
			headers: { "return-receipt-to": ["expediteur@example.com"] },
		};
		expect(readReceiptRequested(part)).toBe(true);
	});

	it("détecte l'en-tête Disposition-Notification-To", () => {
		const part = {
			contentType: "text/html",
			body: "<p>Bonjour</p>",
			headers: {
				"disposition-notification-to": ["expediteur@example.com"],
			},
		};
		expect(readReceiptRequested(part)).toBe(true);
	});

	it("renvoie false sans en-tête d'accusé de réception", () => {
		const part = {
			contentType: "text/html",
			body: "<p>Bonjour</p>",
			headers: { subject: ["Salut"] },
		};
		expect(readReceiptRequested(part)).toBe(false);
	});

	it("renvoie false sans en-têtes du tout", () => {
		const part = { contentType: "text/html", body: "<p>Bonjour</p>" };
		expect(readReceiptRequested(part)).toBe(false);
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
