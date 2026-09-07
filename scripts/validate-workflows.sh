#!/usr/bin/env bash
# n8n/workflows/*.js 가 SDK 파서로 실제 워크플로 JSON이 되는지 확인한다.
#
#   bash scripts/validate-workflows.sh              # 전부
#   bash scripts/validate-workflows.sh sub-fetch-metrics.js
#
# SDK 파서는 임의 JS를 실행하지 않는 제한된 AST 인터프리터다. map 같은 배열 메서드,
# 함수 선언, 헬퍼 변수를 쓴 코드는 여기서 걸린다. 로컬에서 그냥 import 해보는 것만으로는
# 잡히지 않으므로(평범한 JS로는 잘 돌아간다) 커밋 전에 이 스크립트를 돌려야 한다.
# 런타임 로직은 전부 code 노드의 jsCode 안에 두고, 워크플로 파일은 리터럴로 펼쳐 둔다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="npx --yes @n8n/workflow-sdk"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ $# -gt 0 ]; then
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$(basename "$f")"); done < <(find "$ROOT/n8n/workflows" -name '*.js' | sort)
fi

fail=0
for name in "${FILES[@]}"; do
  src="$ROOT/n8n/workflows/$name"
  [ -f "$src" ] || { echo "FAIL  $name  (파일 없음)"; fail=$((fail + 1)); continue; }
  # CLI가 import 선언을 거부한다. n8n 쪽도 넘기기 전에 제거한다.
  grep -v "^import .* from '@n8n/workflow-sdk';" "$src" > "$TMP/$name"
  if out=$($CLI code-to-json "$TMP/$name" 2>&1); then
    warn=$(printf '%s' "$out" | grep -c 'Validation warnings' || true)
    echo "PASS  $name$([ "$warn" -gt 0 ] && echo '  (경고 있음)')"
    printf '%s\n' "$out" | sed -n '/Validation warnings/,/^Generated/p' | grep '^  - ' | sed 's/^/        /' || true
  else
    echo "FAIL  $name"
    printf '%s\n' "$out" | head -6 | sed 's/^/        /'
    fail=$((fail + 1))
  fi
done

echo
if [ "$fail" -eq 0 ]; then echo "모두 통과"; else echo "$fail건 실패"; fi
exit "$fail"
