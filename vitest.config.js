"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    test: {
        include: ['tests/**/*.test.{ts,js,mjs}'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
        ],
        // Tests import CJS source modules directly; keep the environment Node-like.
        environment: 'node',
        // Load SDK dependency symlinks before test suites run.
        globals: true,
        testTimeout: 20000,
    },
});
