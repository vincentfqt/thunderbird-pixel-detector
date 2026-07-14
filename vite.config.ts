import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	root: "src",
	publicDir: "../public",
	base: "./",

	build: {
		outDir: "../dist",
		emptyOutDir: true,

		rolldownOptions: {
			input: {
				popup: fileURLToPath(
					new URL("./src/popup/index.html", import.meta.url),
				),
				background: fileURLToPath(
					new URL("./src/background/background.ts", import.meta.url),
				),
			},

			output: {
				entryFileNames: (chunkInfo) => {
					if (chunkInfo.name === "background") {
						return "assets/background.js";
					}

					return "assets/[name]-[hash].js";
				},

				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
			},
		},
	},
});
