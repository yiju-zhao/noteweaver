#!/usr/bin/env node
process.exitCode = require('../../../cli/context.cjs').main(process.argv.slice(2), __filename);
