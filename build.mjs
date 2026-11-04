// Inline the core into the page and write the two outputs:
//   dist/artifact.html — page body only (the Artifact host adds the skeleton)
//   dist/index.html    — complete page for hosting on Cloudflare
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const core = readFileSync('cutter-core.js', 'utf8').replace(/^export /gm, '');
const page = readFileSync('src/page.html', 'utf8').replace('/*CORE*/', () => core);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', page);

// Body content must live in <body>: split head bits (title/meta/link/style) from the rest.
const cut = page.indexOf('<div class="wrap">');
const head = page.slice(0, cut), body = page.slice(cut);
writeFileSync('index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
${head}</head>
<body>
${body}</body>
</html>
`);

// Syntax-check the inlined script.
const script = page.slice(page.indexOf('<script type="module">') + 22, page.lastIndexOf('</script>'));
writeFileSync('dist/.check.mjs', script);
console.log('built', page.length, 'bytes');
