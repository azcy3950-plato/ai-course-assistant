// Verify resources shipped with the repository without Python, Git or a running server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(root, 'public');
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const facilities = ['GR','VS','RG','PP'];

function read(path) {
  try { return readFileSync(resolve(root, path)); }
  catch { throw new Error('缺少仓库文件：' + path + '。请在 GitHub Desktop 中一并提交此文件。'); }
}
function publicPath(url) {
  assert(typeof url === 'string' && url.startsWith('/sandbox/artwork/'), '景观素材必须使用站内路径。');
  const path = resolve(publicRoot, url.slice(1));
  assert(path.startsWith(publicRoot + sep), '景观素材路径不能越出 public 目录。');
  return path;
}
function png(path) {
  const bytes = read(path);
  assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature), path + ' 不是有效的 PNG。');
  return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

try {
  const layout = JSON.parse(read('src/lib/sandbox/artwork-layout.json').toString('utf8'));
  const paths = [layout.base, ...facilities.map(f => layout.assets[f].src)];
  const manifests = new Map();
  let totalBytes = 0;
  for (const [index, url] of paths.entries()) {
    const path = publicPath(url), image = png(path), directory = dirname(path);
    if (!manifests.has(directory)) manifests.set(directory, JSON.parse(read(resolve(directory, 'provenance.json')).toString('utf8')));
    const expected = manifests.get(directory).hashes?.[basename(path)];
    assert(expected, '素材来源记录缺少 ' + basename(path));
    assert.equal(createHash('sha256').update(image.bytes).digest('hex'), expected, url + ' 与来源记录不一致。修改已发布素材时应新增版本。');
    if (index === 0) {
      assert.equal(image.width, layout.canvas.width, '景观底图宽度与布局不一致。');
      assert.equal(image.height, layout.canvas.height, '景观底图高度与布局不一致。');
    } else {
      const facility = facilities[index-1], rect = layout.assets[facility].sourceRect;
      assert(rect.length === 4 && rect.every(Number.isFinite), facility + ' 素材裁剪范围无效。');
      const [x,y,width,height] = rect;
      assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x+width <= image.width && y+height <= image.height, facility + ' 裁剪范围超出素材尺寸。');
    }
    totalBytes += image.bytes.length;
  }
  for (const path of ['public/zijing_inp.inp','scripts/sandbox-run.py','scripts/sandbox-setup.mjs','requirements-sandbox.txt']) {
    assert(read(path).length > 0, path + ' 不能为空。');
  }
  const pkg = JSON.parse(read('package.json').toString('utf8'));
  const lock = JSON.parse(read('package-lock.json').toString('utf8')).packages[''];
  for (const field of ['dependencies','devDependencies']) assert.deepEqual(pkg[field], lock[field], 'package.json 与 package-lock.json 的 ' + field + ' 不一致。');
  console.log('沙盘资源完整：5 张景观素材（' + (totalBytes/1024/1024).toFixed(1) + ' MB）、原始模型、Python 运行脚本和依赖清单。');
} catch (error) {
  console.error('沙盘源码检查失败：' + error.message);
  process.exitCode = 1;
}
