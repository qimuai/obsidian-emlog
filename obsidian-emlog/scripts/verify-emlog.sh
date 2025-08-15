#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [[ -z "${EMLOG_BASE_URL:-}" || -z "${EMLOG_API_KEY:-}" ]]; then
  echo "[verify] 请设置环境变量 EMLOG_BASE_URL 与 EMLOG_API_KEY 再运行本脚本。"
  echo "示例： EMLOG_BASE_URL=https://qimuai.cn EMLOG_API_KEY=xxxx npm run verify"
  exit 1
fi

export RUN_EMLOG_TESTS=1

echo "[verify] 1/4 检查分类列表 sort_list ..."
npx vitest run tests/emlog.integration.test.ts -t "sort_list" --silent || { echo "[verify] sort_list 失败"; exit 1; }

echo "[verify] 2/4 检查发布微语 note_post ..."
npx vitest run tests/emlog.integration.test.ts -t "note_post" --silent || { echo "[verify] note_post 失败"; exit 1; }

echo "[verify] 3/4 检查上传 upload ..."
npx vitest run tests/emlog.article.test.ts -t "upload should accept a tiny png" --silent || { echo "[verify] upload 失败"; exit 1; }

echo "[verify] 4/4 检查文章发布/更新 article_post/article_update ..."
npx vitest run tests/emlog.article.test.ts -t "article_post then article_update" --silent || { echo "[verify] 文章发布/更新 失败"; exit 1; }

echo "[verify] 所有检查通过 ✅"
