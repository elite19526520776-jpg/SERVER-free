// 打包脚本：把所有 ES 模块 + 样式表塞进一个可直接双击打开的 HTML 文件。
//
// 做法：把每个模块的源码原样嵌进 HTML，运行时按依赖顺序为每个模块创建 Blob URL，
// 并把它们之间的相对 import 改写成对应的 Blob URL。这样既不用改动任何模块语法，
// 也绕开了 file:// 协议下 ES 模块的跨域限制。
//
// 用法： node build.mjs   →  生成 dist/voxelcraft.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = 'src/main.js';

function listModules(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) listModules(full, out);
    else if (name.endsWith('.js')) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

const modules = listModules(path.join(root, 'src'));
const sources = {};
for (const m of modules) sources[m] = fs.readFileSync(path.join(root, m), 'utf8');

// 收集依赖关系（只解析相对路径的 import / export … from）
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]/g;
const deps = {};
for (const m of modules) {
  deps[m] = [];
  for (const match of sources[m].matchAll(IMPORT_RE)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(m), match[1]));
    if (sources[resolved]) deps[m].push(resolved);
    else console.warn(`警告：${m} 引用了未找到的模块 ${match[1]}`);
  }
}

// 拓扑排序（依赖在前）
const order = [];
const state = {};
function visit(m, stack = []) {
  if (state[m] === 'done') return;
  if (state[m] === 'visiting') {
    // 循环依赖对 Blob 方案是致命的，必须显式报错
    throw new Error(`检测到循环依赖：${[...stack, m].join(' → ')}`);
  }
  state[m] = 'visiting';
  for (const d of deps[m]) visit(d, [...stack, m]);
  state[m] = 'done';
  order.push(m);
}
for (const m of modules) visit(m);

const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 取出 index.html 的 <body> 内容，去掉外链脚本与样式
const bodyMatch = /<body>([\s\S]*?)<\/body>/.exec(html);
let body = bodyMatch ? bodyMatch[1] : '';
body = body.replace(/<script[\s\S]*?<\/script>/g, '').trim();
const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(html);
const title = titleMatch ? titleMatch[1] : '方块世界';
const iconMatch = /<link rel="icon"[^>]*>/.exec(html);

const loader = `
const __SOURCES = ${JSON.stringify(sources)};
const __ORDER = ${JSON.stringify(order)};
const __URLS = {};

function __dirname_(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function __resolve(from, spec) {
  const parts = (__dirname_(from) + '/' + spec).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

for (const name of __ORDER) {
  const code = __SOURCES[name].replace(
    /(from\\s*)(['"])(\\.[^'"]+)\\2/g,
    (m, kw, q, spec) => {
      const target = __resolve(name, spec);
      if (!__URLS[target]) throw new Error('模块未就绪：' + target + '（被 ' + name + ' 引用）');
      return kw + JSON.stringify(__URLS[target]);
    },
  );
  __URLS[name] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

import(__URLS[${JSON.stringify(ENTRY)}]).catch((err) => {
  console.error(err);
  const s = document.getElementById('loading-status');
  if (s) s.textContent = '启动失败：' + err.message;
});
`;

const out = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${title}</title>
${iconMatch ? iconMatch[0] : ''}
<style>
${css}
</style>
</head>
<body>
${body}
<script type="module">
${loader}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'voxelcraft.html');
fs.writeFileSync(dest, out);
console.log(`已生成 ${path.relative(root, dest)}（${order.length} 个模块，${(out.length / 1024).toFixed(0)} KB）`);
console.log('模块顺序：', order.join(' → '));
