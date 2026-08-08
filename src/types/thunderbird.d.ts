// src/types/thunderbird.d.ts
// Types minimaux des API spécifiques à Thunderbird (mailTabs, messageDisplay,
// messages) non incluses dans @types/firefox-webext-browser.
// Documentation de référence : https://webextension-api.thunderbird.net/

/// <reference types="firefox-webext-browser" />

/** En-tête d'un message renvoyé par les API messages / messageDisplay. */
interface ThunderbirdMessageHeader {
	id: number;
	subject: string;
	author: string;
	date: number;
	read: boolean;
}

/** Partie MIME d'un message renvoyée par messages.getFull. */
interface ThunderbirdMessagePart {
	contentType?: string;
	body?: string | null;
	parts?: ThunderbirdMessagePart[];
	partName?: string;
}

/** Onglet de messagerie renvoyé par mailTabs.getCurrent. */
interface ThunderbirdMailTab {
	id: number;
	windowId: number;
	active: boolean;
	showing: boolean;
}

/** API Thunderbird absentes de @types/firefox-webext-browser. */
interface ThunderbirdApi {
	mailTabs: {
		getCurrent(): Promise<ThunderbirdMailTab>;
	};
	messageDisplay: {
		getDisplayedMessage(
			tabId: number,
		): Promise<ThunderbirdMessageHeader | null>;
		onMessageDisplayed: {
			addListener(
				listener: (
					tab: ThunderbirdMailTab,
					message: ThunderbirdMessageHeader,
				) => void,
			): void;
			removeListener(
				listener: (
					tab: ThunderbirdMailTab,
					message: ThunderbirdMessageHeader,
				) => void,
			): void;
		};
	};
	messages: {
		getFull(messageId: number): Promise<ThunderbirdMessagePart>;
	};
}

declare const messenger: typeof browser & ThunderbirdApi;
