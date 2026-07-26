/**
 * 把 Expo 的 web 导出产物复制到 Electron 的 renderer 目录。
 * electron-builder 只打包应用自己目录下的文件，不能直接引用 ../app/dist。
 */
const fs = require('node:fs');
const path = require('node:path');

const src = path.resolve(__dirname, '../../app/dist');
const dest = path.resolve(__dirname, '../renderer');

if (!fs.existsSync(src)) {
  console.error(`找不到 web 产物：${src}\n请先运行：npm --prefix ../app run export:web`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const files = fs.readdirSync(dest);
console.log(`已同步 ${files.length} 个顶层条目到 ${path.relative(process.cwd(), dest)}`);
