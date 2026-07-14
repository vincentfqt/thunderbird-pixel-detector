// src/types/thunderbird.d.ts

/// <reference types="firefox-webext-browser" />

declare const messenger: typeof browser;

// declare namespace browser {
//   namespace accounts {
//     function list(): Promise<
//       Array<{
//         id: string;
//         name: string;
//       }>
//     >;
//   }

//   namespace mailTabs {
//     function getCurrent(): Promise<{
//       id: number;
//     }>;
//   }

//   namespace messages {
//     function list(folder: unknown): Promise<{
//       id: number;
//       messages: unknown[];
//     }>;
//   }
// }
