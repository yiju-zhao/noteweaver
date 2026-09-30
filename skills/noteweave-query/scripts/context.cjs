#!/usr/bin/env node
// Bundled by the release build; the installed script has no sibling runtime dependency.
process.exitCode = require('../../../src/context.ts').main(process.argv.slice(2), __filename);
