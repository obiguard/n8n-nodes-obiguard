import type { Config } from 'jest';

const config: Config = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/nodes'],
	testMatch: ['**/__tests__/**/*.test.ts'],
	collectCoverageFrom: [
		'nodes/**/*.ts',
		'!nodes/**/__tests__/**',
		'!nodes/**/*.d.ts',
	],
	coverageReporters: ['text', 'lcov', 'cobertura'],
	coverageThreshold: {
		global: {
			lines: 80,
		},
	},
};

export default config;
