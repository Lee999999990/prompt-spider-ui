#!/bin/bash
# 双击即可：抽数据 → 出图 → 与工作台记忆图合并 → 开本地服务
set -e
cd "$(dirname "$0")"
NODE="${NODE:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node)"
export PATH="$(dirname "$NODE"):$PATH"
echo "== 1/4 抽提问 =="; "$NODE" src/extract.mjs
echo "== 2/4 布局蛛网 =="; "$NODE" src/spider.mjs
echo "== 3/4 与记忆图合并 =="
MEM="../../工作台/记忆图/graph.json"
[ -f "$MEM" ] && "$NODE" src/merge.mjs "$MEM" data/spider-graph.json -o data/merged.json || echo "（没找到记忆图，跳过合并）"
echo "== 4/4 自测 =="; "$NODE" selftest.mjs
echo "== 开服务 =="; exec "$NODE" serve.mjs --port 8791
