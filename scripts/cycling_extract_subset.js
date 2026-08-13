'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');
const { finished } = require('stream/promises');

// Extracts a bbox subset of nodes.ndjson + edges.ndjson into a separate dir.
// Used as a backup / verification dataset when full Kansai CH preprocessing
// is too slow.
//
// Usage:
//   node scripts/cycling_extract_subset.js \
//     --src data/cycling --dst data/cycling-osaka \
//     --bbox 135.4,34.6,135.6,34.8

function parseArgs(argv = process.argv.slice(2)) {
  const args = { src: null, dst: null, bbox: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--src') args.src = argv[++i] || null;
    else if (a === '--dst') args.dst = argv[++i] || null;
    else if (a === '--bbox') args.bbox = argv[++i] || null;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function parseBbox(str) {
  if (!str) return null;
  const parts = str.split(',');
  if (parts.length !== 4) return null;
  // Number('') は 0 になるため、空要素をそのまま渡すと `135.4,,135.6,34.8` の
  // ようなタイポが「緯度 0 (赤道)」として通ってしまう。空白のみの要素も含めて
  // 先に NaN へ倒して弾く。
  const nums = parts.map((p) => (p.trim() === '' ? NaN : Number(p)));
  if (!nums.every(Number.isFinite)) return null;
  return { minLon: nums[0], minLat: nums[1], maxLon: nums[2], maxLat: nums[3] };
}

// onLine を await する。呼び出し側が書き込みの drain を待てるようにして、
// 1GB 級の ndjson でも出力側のバッファが際限なく膨らまないようにする。
async function streamLines(filePath, onLine) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  // 入力ストリームのエラー (ENOENT / EACCES など) を明示的に拾って reject する。
  // readline 経由の伝播に頼ると、失敗が握り潰されて「0 件抽出で成功」に
  // 見えかねない。
  const failed = new Promise((_resolve, reject) => {
    input.once('error', reject);
  });
  const consume = (async () => {
    for await (const line of rl) {
      if (!line) continue;
      await onLine(line);
    }
  })();
  try {
    await Promise.race([consume, failed]);
  } finally {
    rl.close();
    input.destroy();
  }
}

/** write() が false を返したら drain を待つ (バックプレッシャー)。 */
async function writeLine(stream, line) {
  if (!stream.write(line + '\n')) await once(stream, 'drain');
}

/**
 * 比較用にパスを正規化する。symlink を解決したいが、dst はまだ存在しない
 * ことがあるので、その場合は絶対パスのまま返す。
 */
function canonicalPath(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** ファイルの実体を一意に識別するキー。存在しなければ null。 */
function fileIdentity(p) {
  try {
    // statSync は symlink を追うので、symlink とハードリンクの両方で
    // 参照先の dev/ino が得られる。
    const st = fs.statSync(p);
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
}

/**
 * 出力候補が入力候補と同じ実体を指していれば [dstFile, srcFile] を返す。
 * 無ければ null。
 *
 * ディレクトリ単位の realpath 比較 (canonicalPath) では次がすり抜ける。
 *
 *   - dst/nodes.ndjson が src/edges.ndjson へのハードリンク
 *     (ハードリンクは realpath では解決されない)
 *   - dst/nodes.ndjson が src/edges.ndjson への symlink
 *     (ディレクトリは別だがファイルの実体は同じ)
 *
 * どちらも「読みながら同じ実体を truncate する」経路なので、dev/ino で
 * 突き合わせて弾く。nodes と edges は別パスで書くため、pass 1 の前に
 * 全組み合わせをまとめて見る (pass 1 が通っても pass 2 で壊れうる)。
 */
function findFileAliasing(srcFiles, dstFiles) {
  const bySrcIdentity = new Map();
  for (const f of srcFiles) {
    const id = fileIdentity(f);
    if (id) bySrcIdentity.set(id, f);
  }
  for (const f of dstFiles) {
    const id = fileIdentity(f);
    if (!id) continue;
    const hit = bySrcIdentity.get(id);
    if (hit) return [f, hit];
  }
  return null;
}

/**
 * srcFile を 1 行ずつ読み、keepLine が true を返した行だけ dstFile に書く。
 * 返り値は { seen, kept }。
 *
 * 出力ストリームの error は生成直後に購読する。write() は成功しても後から
 * ENOSPC 等で落ちることがあり、'error' に購読者がいないと Node が例外を
 * 投げてプロセスごと死ぬ (main().catch に届かない)。失敗時は入力・出力とも
 * 破棄してから呼び出し元へ投げ直す。
 */
async function filterInto(srcFile, dstFile, keepLine) {
  const out = fs.createWriteStream(dstFile);
  const outFailed = new Promise((_resolve, reject) => {
    out.once('error', reject);
  });
  let seen = 0;
  let kept = 0;
  try {
    await Promise.race([
      (async () => {
        await streamLines(srcFile, async (line) => {
          seen += 1;
          if (keepLine(line)) {
            await writeLine(out, line);
            kept += 1;
          }
        });
        out.end();
        await finished(out);
      })(),
      outFailed
    ]);
  } catch (err) {
    out.destroy();
    throw err;
  }
  return { seen, kept };
}

async function main() {
  const args = parseArgs();
  if (args.help || !args.src || !args.dst || !args.bbox) {
    process.stdout.write(
      'Usage: node scripts/cycling_extract_subset.js --src <dir> --dst <dir> --bbox minLon,minLat,maxLon,maxLat\n'
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const bbox = parseBbox(args.bbox);
  if (!bbox) {
    process.stderr.write('invalid bbox\n');
    process.exitCode = 1;
    return;
  }

  // src と dst が同じだと、読みながら同じファイルを truncate して元データを
  // 壊す。1GB 級の抽出元を失うと再取得コストが大きいので、書き始める前に弾く。
  // path.resolve だけでは symlink 経由の別名 (data/cycling と data/alias が
  // 同じ実体) をすり抜けるため、実在するパスは realpath まで解決して比べる。
  if (canonicalPath(args.src) === canonicalPath(args.dst)) {
    process.stderr.write('--src and --dst must differ (would overwrite the source)\n');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(args.dst, { recursive: true });

  const srcNodes = path.join(args.src, 'nodes.ndjson');
  const srcEdges = path.join(args.src, 'edges.ndjson');
  const dstNodes = path.join(args.dst, 'nodes.ndjson');
  const dstEdges = path.join(args.dst, 'edges.ndjson');

  // ディレクトリが別でも、ファイル単位で同じ実体を指していれば元データを壊す。
  const alias = findFileAliasing([srcNodes, srcEdges], [dstNodes, dstEdges]);
  if (alias) {
    process.stderr.write(
      `output ${alias[0]} is the same file as input ${alias[1]} (would overwrite the source)\n`
    );
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  const keepIds = new Set();

  process.stderr.write('[pass 1/2] filtering nodes by bbox\n');
  const nodes = await filterInto(
    srcNodes,
    dstNodes,
    (line) => {
      const n = JSON.parse(line);
      const inside =
        n.lon >= bbox.minLon && n.lon <= bbox.maxLon &&
        n.lat >= bbox.minLat && n.lat <= bbox.maxLat;
      if (inside) keepIds.add(n.id);
      return inside;
    }
  );
  process.stderr.write(`  nodes ${nodes.kept}/${nodes.seen} in ${Date.now() - t0}ms\n`);

  const t1 = Date.now();
  process.stderr.write('[pass 2/2] filtering edges (both endpoints in bbox)\n');
  const edges = await filterInto(
    srcEdges,
    dstEdges,
    (line) => {
      const e = JSON.parse(line);
      return keepIds.has(e.from) && keepIds.has(e.to);
    }
  );
  process.stderr.write(`  edges ${edges.kept}/${edges.seen} in ${Date.now() - t1}ms\n`);
  process.stderr.write(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, parseBbox, findFileAliasing };
