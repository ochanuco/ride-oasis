// cycling-router の GitHub Release から WASM 成果物を取得して配置する。
//
//   vendor/wasm/bundler/  → worker.mjs が import する Workers 用 (wrangler が
//                           [[rules]] CompiledWasm で .wasm をバンドルする)
//   vendor/wasm/nodejs/   → scripts/*_bench.js が require するベンチ用
//   frontend/wasm/        → ブラウザ用 (wasm_bootstrap.mjs が動的 import)
//
// どちらも git 管理外。`wrangler.toml` の [build] から呼ばれるので、ローカルの
// `wrangler dev` / `wrangler deploy` でも Workers Builds (Cloudflare の CI) でも
// 同じ経路で揃う。
//
// バージョンは下の VERSION でピン留めする。上げるときは VERSION と SHA256 を
// セットで書き換える (SHA256 は `shasum -a 256 <アーカイブ>` で得る)。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const VERSION = 'v0.4.0';
const REPO = 'ochanuco/cycling-router';
const ASSET = `cycling-router-wasm-${VERSION}.tar.gz`;
const URL = `https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}`;
// 取得したアーカイブの検証用ダイジェスト。展開前に照合し、不一致なら中断する。
// Release の差し替えや取得経路の改竄があれば、tar を展開して JS wrapper と
// WASM を配置する前に気づける。
const SHA256 = 'c7edce8506318790a19cf76196ac3ce5e976db4f5c7e2dca6b7060266217044a';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'wasm');
const FRONTEND_WASM = path.join(ROOT, 'frontend', 'wasm');

// 配置後に必ず存在すべきファイル。欠けていればビルドを止める (壊れた成果物で
// デプロイして本番で 500 を出さないため)。
const REQUIRED = [
  [VENDOR, 'bundler', 'router_wasm_worker.js'],
  [VENDOR, 'bundler', 'router_wasm_bg.js'],
  [VENDOR, 'bundler', 'router_wasm_bg.wasm'],
  [VENDOR, 'nodejs', 'router_wasm.js'],
  [VENDOR, 'nodejs', 'router_wasm_bg.wasm'],
  [FRONTEND_WASM, 'router_wasm.js'],
  [FRONTEND_WASM, 'router_wasm_bg.wasm']
];

/** 既に同じバージョンが配置済みなら再取得しない。 */
function alreadyFetched() {
  const stamp = path.join(VENDOR, '.version');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8').trim() !== VERSION) return false;
  return REQUIRED.every((parts) => fs.existsSync(path.join(...parts)));
}

function main() {
  if (alreadyFetched()) {
    process.stdout.write(`wasm ${VERSION} already present; skipping download\n`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rideoasis-wasm-'));
  const archive = path.join(tmp, ASSET);

  process.stdout.write(`fetching ${URL}\n`);
  // curl は Workers Builds のビルドイメージにも入っている。-f で HTTP エラーを
  // 終了コードに反映させ、リダイレクト (-L) を追う。
  //
  // ネットワークが不安定でもビルドが無限に待たないよう上限を設ける。
  // --retry-max-time が再試行全体の上限なので、最終試行の後に無駄な待機は入らない。
  execFileSync(
    'curl',
    [
      '-fsSL',
      '--connect-timeout', '10',
      '--max-time', '120',
      '--retry', '3',
      '--retry-delay', '2',
      '--retry-max-time', '180',
      '-o', archive,
      URL
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  // 展開前に検証する。tar は書庫の内容をそのままファイルとして書き出すため、
  // 検証を後回しにすると改竄されたアーカイブを一度ディスクに展開してしまう。
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (digest !== SHA256) {
    throw new Error(
      `checksum mismatch for ${ASSET}\n  expected: ${SHA256}\n  actual:   ${digest}`
    );
  }

  const extracted = path.join(tmp, 'x');
  fs.mkdirSync(extracted, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: ['ignore', 'inherit', 'inherit'] });

  fs.rmSync(VENDOR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(VENDOR), { recursive: true });
  fs.cpSync(path.join(extracted, 'bundler'), path.join(VENDOR, 'bundler'), { recursive: true });
  fs.cpSync(path.join(extracted, 'nodejs'), path.join(VENDOR, 'nodejs'), { recursive: true });

  // ブラウザ側は web ターゲット。frontend/ は wrangler の assets ディレクトリ
  // なので、ここに置いたものがそのまま配信される。
  fs.rmSync(FRONTEND_WASM, { recursive: true, force: true });
  fs.cpSync(path.join(extracted, 'web'), FRONTEND_WASM, { recursive: true });

  const missing = REQUIRED.map((parts) => path.join(...parts)).filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(`wasm artifacts missing after extract:\n  ${missing.join('\n  ')}`);
  }

  fs.writeFileSync(path.join(VENDOR, '.version'), `${VERSION}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`wasm ${VERSION} placed in vendor/wasm/ and frontend/wasm/\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fetch_wasm failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
}
