#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const [basePath, replacementPath, outputPath] = process.argv.slice(2);
if (!basePath || !replacementPath || !outputPath) {
  throw new Error('Usage: node merge-ale-field-extraction-results.js <base.json> <replacement.json> <output.json>');
}
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const replacement = JSON.parse(fs.readFileSync(replacementPath, 'utf8'));
const replacements = new Map((replacement.results || []).map((item) => [item.input, item]));
const merged = {
  results: (base.results || []).map((item) => replacements.get(item.input) || item),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
console.log(JSON.stringify({ outputPath, replacements: [...replacements.keys()], total: merged.results.length }, null, 2));
