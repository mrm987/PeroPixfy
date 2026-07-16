#!/usr/bin/env bash
# 레지스트리 버전 상세의 '업데이트 내역(changelog)'을 CHANGELOG.md의 '## <version>' 섹션으로 채운다.
#
# publish-node-action(입력이 token/skip_checkout뿐)도 pyproject.toml 명세도 changelog를 지원하지
# 않아서, 레지스트리 API로 직접 넣는다 (1.0.0~1.2.0이 전부 비어 있던 이유):
#   PUT /publishers/{publisherId}/nodes/{nodeId}/versions/{version}   body={"changelog": "..."}
# {version}은 semver 문자열을 그대로 받고, 인증은 게시와 같은 토큰(Authorization: Bearer).
#
# 사용: REGISTRY_TOKEN=pat-xxx bash .github/scripts/set-changelog.sh [version] [retries]
#   version 생략/빈값 → pyproject.toml의 version
#   retries 생략 → 1 (게시 직후엔 버전 반영이 늦을 수 있어 publish 워크플로우에선 크게 준다)
set -uo pipefail

VERSION="${1:-}"
RETRIES="${2:-1}"

field() { grep -m1 "^$1" pyproject.toml | sed -E "s/^$1 *= *\"([^\"]+)\".*/\1/"; }
[ -n "$VERSION" ] || VERSION=$(field version)
NODE=$(field name)
PUBLISHER=$(field PublisherId)

# 해당 버전 섹션만 추출(다음 '## ' 헤딩 전까지).
NOTES=$(awk -v v="## $VERSION" '$0 == v {f=1; next} /^## /{f=0} f' CHANGELOG.md)
if [ -z "$(printf '%s' "$NOTES" | tr -d '[:space:]')" ]; then
  echo "::error::CHANGELOG.md에 '## $VERSION' 섹션이 없다"
  exit 1
fi

jq -n --arg c "$NOTES" '{changelog: $c}' > /tmp/changelog.json
URL="https://api.comfy.org/publishers/$PUBLISHER/nodes/$NODE/versions/$VERSION"

for i in $(seq 1 "$RETRIES"); do
  if curl -fsS -X PUT "$URL" \
      -H "Authorization: Bearer $REGISTRY_TOKEN" \
      -H "Content-Type: application/json" \
      --data @/tmp/changelog.json; then
    echo "changelog set: $NODE $VERSION ($(printf '%s' "$NOTES" | wc -c) bytes)"
    exit 0
  fi
  if [ "$i" -lt "$RETRIES" ]; then
    echo "attempt $i failed — retrying in 10s"
    sleep 10
  fi
done

echo "::error::changelog 설정 실패: $VERSION"
exit 1
