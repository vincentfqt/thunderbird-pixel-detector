import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Listener = (tab: ThunderbirdMailTab, list: ThunderbirdMessageList) => void;
type MessageListener = (message: {
	type: "ANALYZE_CURRENT_MESSAGE";
}) => Promise<{ error?: string; multipleMessages?: boolean }>;

let displayed: Listener;
let request: MessageListener;
const tab = { tabId: 1, windowId: 1, active: true };
const header = (id: number): ThunderbirdMessageHeader => ({
	id,
	subject: "",
	author: "",
	date: 0,
	read: false,
});
const setBadgeText = vi.fn().mockResolvedValue(undefined);
const setLabel = vi.fn().mockResolvedValue(undefined);
const getFull = vi.fn();

beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.clearAllMocks();
	vi.stubGlobal("messenger", {
		runtime: {
			onInstalled: { addListener: vi.fn() },
			onMessage: {
				addListener: (fn: MessageListener) => {
					request = fn;
				},
			},
		},
		mailTabs: { query: vi.fn().mockResolvedValue([tab]) },
		messageDisplay: {
			onMessagesDisplayed: {
				addListener: (fn: Listener) => {
					displayed = fn;
				},
			},
			getDisplayedMessages: vi
				.fn()
				.mockResolvedValue({ messages: [header(1), header(2)] }),
		},
		messages: { getFull },
		action: {
			setBadgeText: vi.fn().mockResolvedValue(undefined),
			setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
		},
		messageDisplayAction: {
			setBadgeText,
			setLabel,
			setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
			setTitle: vi.fn().mockResolvedValue(undefined),
		},
	});
	await import("./background");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("indique qu'une sélection multiple n'analyse que le premier message", async () => {
	getFull.mockResolvedValue({ contentType: "text/html", body: "" });
	const result = await request({ type: "ANALYZE_CURRENT_MESSAGE" });
	expect(result.multipleMessages).toBe(true);
	expect(getFull).toHaveBeenCalledWith(1);
});

it("efface le badge après une erreur de lecture", async () => {
	getFull.mockRejectedValue(new Error("lecture impossible"));
	const result = await request({ type: "ANALYZE_CURRENT_MESSAGE" });
	expect(result.error).toBeDefined();
	expect(setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: "" });
	expect(setLabel).toHaveBeenCalledWith({
		tabId: 1,
		label: "Analyse indisponible",
	});
});

it("ignore une ancienne analyse terminée après la nouvelle", async () => {
	let finishOld: (part: ThunderbirdMessagePart) => void = () => {};
	getFull.mockImplementation((id: number) =>
		id === 1
			? new Promise<ThunderbirdMessagePart>((resolve) => {
					finishOld = resolve;
				})
			: Promise.resolve({
					contentType: "text/html",
					body: '<img src="https://example.com/pixel.gif">',
				}),
	);
	displayed(tab, { id: 1, messages: [header(1)] });
	await vi.advanceTimersByTimeAsync(300);
	displayed(tab, { id: 2, messages: [header(2)] });
	await vi.advanceTimersByTimeAsync(300);
	finishOld({ contentType: "text/html", body: "" });
	await vi.advanceTimersByTimeAsync(0);
	expect(setLabel).toHaveBeenCalledTimes(1);
	expect(setLabel).toHaveBeenCalledWith({ tabId: 1, label: "1 menace(s)" });
});
