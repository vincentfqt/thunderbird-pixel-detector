// src/models/tracking.ts
// Types du domaine de détection de tracking. Définis ici pour être réutilisables
// par le moteur (lib/detector.ts), le background et le popup.

/** Image distante classée comme pixel de suivi. */
export interface TrackingPixel {
	url: string;
	width: number | null;
	height: number | null;
	/** Pourquoi cette image est considérée comme un pixel. */
	reasons: string[];
}

/** Résultat complet de l'analyse d'un message. */
export interface AnalysisResult {
	/** Nombre total d'images distantes dans le message. */
	remoteImageCount: number;
	/** Images classées comme pixels de suivi. */
	trackingPixels: TrackingPixel[];
	/** Liens <a href> classés comme liens de suivi des clics. */
	trackingLinks: TrackingLink[];
	/** Ressources distantes non-image classées comme suspectes. */
	trackingResources: TrackingResource[];
	/** true si le message demande un accusé de réception (Return-Receipt-To…). */
	readReceiptRequested?: boolean;
	/** Erreur éventuelle (ex. aucun message affiché). */
	error?: string;
}

/** Lien de suivi des clics détecté dans un <a href>. */
export interface TrackingLink {
	url: string;
	/** Pourquoi ce lien est considéré comme un lien de suivi. */
	reasons: string[];
}

/** Ressource distante non-image suspecte (iframe, link, embed…). */
export interface TrackingResource {
	url: string;
	width: number | null;
	height: number | null;
	/** Pourquoi cette ressource est considérée comme suspecte. */
	reasons: string[];
}
