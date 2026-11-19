/**
 * 把 vite build 的产物合成一个单文件页面，用来发布到 claude.ai（私有页面，手机登录即可玩）。
 *   npm run artifact   →  artifact/card-battle.html
 * 发布平台会自动包上 <!doctype><html><head><body>，所以这里不写这些标签。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');
const files = readdirSync(assets);
const read = (ext) =>
  files.filter((f) => f.endsWith(ext)).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

const css = read('.css');
// 防止代码里出现 </script> 把内联脚本提前截断
const js = read('.js').replace(/<\/script/gi, '<\\/script');

const html = `<title>卡牌对战</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
#boot-diag { display: none; margin: 16px; padding: 12px; border-radius: 8px; background: #5d1a1a; color: #fff; font: 14px/1.5 sans-serif; word-break: break-all; }
</style>
<script>
(function () {
  function show(msg) {
    var box = document.getElementById('boot-diag');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML += '<div>' + msg + '</div>';
  }
  window.addEventListener('error', function (e) { show('页面脚本出错：' + (e.message || e)); }, true);
  window.addEventListener('unhandledrejection', function (e) { show('页面脚本出错：' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
})();
</script>
<div id="boot-diag"></div>
<div id="app"></div>
<script type="module">
${js}
</script>
`;

mkdirSync(join(root, 'artifact'), { recursive: true });
const out = join(root, 'artifact', 'card-battle.html');
writeFileSync(out, html);
console.log(`已生成 ${out}（${(html.length / 1024).toFixed(1)} KB）`);
