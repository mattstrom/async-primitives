import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
	build: {
		outDir: 'dist',
		minify: false,
		sourcemap: true,
		lib: {
			entry: resolve(import.meta.dirname, 'src/index.ts'),
			name: 'async-primitives',
			fileName: 'index',
			formats: ['es', 'umd', 'cjs'],
		},
	},
	pack: {
		dts: {
			tsgo: true,
		},
		format: ['esm', 'cjs'],
		sourcemap: true,
		minify: false,
		exports: true,
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	fmt: {
		semi: true,
		singleQuote: true,
		useTabs: true,
	},
});
