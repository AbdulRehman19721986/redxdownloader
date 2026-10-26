const asar = require('@electron/asar');
const read = name => asar.extractFile('release-v4/win-unpacked/resources/app.asar', name).toString();
const html = read('renderer/index.html');
const engine = read('core/engine.mjs');
const content = read('extension/content.js');
const bg = read('extension/background.js');
console.log(JSON.stringify({
  bulkBar: html.includes('id="bulk-bar"'),
  aboutPanel: html.includes('data-panel="about"'),
  settingsSections: (html.match(/data-section="/g) || []).length,
  qualityRegex: engine.includes('preferredQuality'),
  hoverGrace: content.includes('GRACE_MS = 8000'),
  earlyIntercept: content.includes('onLinkClick'),
  listForPage: content.includes('listForPage') && bg.includes('listForPage'),
  deleteFiles: read('desktop/main.cjs').includes('deleteFiles')
}, null, 2));
