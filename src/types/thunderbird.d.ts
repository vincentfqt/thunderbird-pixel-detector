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

/** Liste de messages renvoyée par messageDisplay.getDisplayedMessages. */
interface ThunderbirdMessageList {
	id: number;
	messages: ThunderbirdMessageHeader[];
}

/** Onglet de messagerie renvoyé par mailTabs.query. */
interface ThunderbirdMailTab {
	tabId: number;
	windowId: number;
	active: boolean;
}

/** API Thunderbird absentes de @types/firefox-webext-browser. */
interface ThunderbirdApi {
	mailTabs: {
		query(queryInfo?: {
			active?: boolean;
			currentWindow?: boolean;
		}): Promise<ThunderbirdMailTab[]>;
	};
	messageDisplay: {
		getDisplayedMessages(tabId?: number): Promise<ThunderbirdMessageList>;
		onMessagesDisplayed: {
			addListener(
				listener: (
					tab: ThunderbirdMailTab,
					displayedMessages: ThunderbirdMessageList,
				) => void,
			): void;
			removeListener(
				listener: (
					tab: ThunderbirdMailTab,
					displayedMessages: ThunderbirdMessageList,
				) => void,
			): void;
		};
	};
	messages: {
		getFull(messageId: number): Promise<ThunderbirdMessagePart>;
	};
	messageDisplayAction: {
		setBadgeText(details: {
			tabId?: number;
			text: string | null;
		}): Promise<void>;
		setBadgeBackgroundColor(details: {
			tabId?: number;
			color: string | null;
		}): Promise<void>;
		setLabel(details: { tabId?: number; label: string | null }): Promise<void>;
		setTitle(details: { tabId?: number; title: string | null }): Promise<void>;
	};
}

declare const messenger: typeof browser & ThunderbirdApi;
