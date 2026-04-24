#!/usr/bin/env bash
#
# Scaffold a new module from templates/s-module/.
#
# Usage: bun run new-module s-notifications
#        bun run new-module notifications
#
# Creates:
#   packages/s-{name}/  (core, functions, tests)
#   infra/s-{name}.ts   (SST stack)
# Updates:
#   .github/CODEOWNERS  (new module entry)
#   sst.config.ts       (imports the new stack)

set -euo pipefail

RAW_NAME="${1:-}"

if [ -z "$RAW_NAME" ]; then
  echo "Usage: bun run new-module s-{name}"
  echo "   or: bun run new-module {name}"
  echo "Example: bun run new-module s-notifications"
  echo "Example: bun run new-module notifications"
  exit 1
fi

if [[ "$RAW_NAME" == s-* ]]; then
  NAME="$RAW_NAME"
  SHORT="${NAME#s-}"
else
  SHORT="$RAW_NAME"
  NAME="s-${SHORT}"
fi

if [[ ! "$SHORT" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Error: module name must match ^s-[a-z][a-z0-9-]*$ or ^[a-z][a-z0-9-]*$"
  exit 1
fi

MODULE_PASCAL="$(printf '%s' "$SHORT" | awk -F- '{ for (i = 1; i <= NF; i++) printf toupper(substr($i, 1, 1)) substr($i, 2) }')"

MODULE_DIR="packages/${NAME}"
INFRA_FILE="infra/${NAME}.ts"

if [ -d "$MODULE_DIR" ]; then
  echo "Error: ${MODULE_DIR} already exists"
  exit 1
fi

echo "===> Scaffolding ${NAME}"

# Copy template directory
cp -r templates/s-module "$MODULE_DIR"

# Replace placeholders in all files:
#   s-notifications → {module-name}
#   notifications   → {module}
#   Notifications   → {Module}
find "$MODULE_DIR" -type f \( -name "*.ts" -o -name "*.json" -o -name "*.md" \) -exec \
  perl -pi -e "s/\\{module\\}/${SHORT}/g; s/\\{module-name\\}/${NAME}/g; s/\\{Module\\}/${MODULE_PASCAL}/g" {} +

# Rename files/directories containing placeholders, e.g. schemas/{module}.schema.ts.
while IFS= read -r path; do
  target="${path//\{module-name\}/$NAME}"
  target="${target//\{module\}/$SHORT}"
  target="${target//\{Module\}/$MODULE_PASCAL}"
  if [ "$path" != "$target" ]; then
    mv "$path" "$target"
  fi
done < <(find "$MODULE_DIR" -depth \( -name "*{module}*" -o -name "*{module-name}*" -o -name "*{Module}*" \))

# Create infra stack file from template
mkdir -p "$(dirname "$INFRA_FILE")"
cp templates/s-module/infra.ts.template "$INFRA_FILE"
perl -pi -e "s/\\{module\\}/${SHORT}/g; s/\\{module-name\\}/${NAME}/g; s/\\{Module\\}/${MODULE_PASCAL}/g" "$INFRA_FILE"
rm -f "${MODULE_DIR}/infra.ts.template"

# Add CODEOWNERS entry
if ! grep -q "/packages/${NAME}/" .github/CODEOWNERS; then
  {
    echo ""
    echo "/packages/${NAME}/          @robo-sk"
    echo "/infra/${NAME}.ts           @robo-sk"
  } >> .github/CODEOWNERS
fi

echo ""
echo "✅ Module ${NAME} scaffolded."
echo ""
echo "Next steps:"
echo "  1. Edit ${MODULE_DIR}/CLAUDE.md — agent rules for this module"
echo "  2. Edit ${MODULE_DIR}/core/src/ — add entities, services, repositories"
echo "  3. Edit ${MODULE_DIR}/functions/src/api.ts — fill in ApiMetadata (permissions, events)"
echo "  4. Edit ${INFRA_FILE} — add DynamoDB tables, routes, event rules"
echo "  5. Uncomment the import in sst.config.ts"
echo "  6. bun install && bun run typecheck && bun run lint"
echo "  7. bun sst deploy --stage \$USER   # personal stage deploy"
