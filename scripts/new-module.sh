#!/usr/bin/env bash
#
# Scaffold a new module from templates/s-module/.
#
# Usage: bun run new-module s-notifications
#
# Creates:
#   packages/s-{name}/  (core, functions, tests)
#   infra/s-{name}.ts   (SST stack)
# Updates:
#   .github/CODEOWNERS  (new module entry)
#   sst.config.ts       (imports the new stack)

set -euo pipefail

NAME="${1:-}"

if [ -z "$NAME" ]; then
  echo "Usage: bun run new-module s-{name}"
  echo "Example: bun run new-module s-notifications"
  exit 1
fi

if [[ ! "$NAME" =~ ^s-[a-z][a-z0-9-]*$ ]]; then
  echo "Error: module name must match ^s-[a-z][a-z0-9-]*$"
  exit 1
fi

MODULE_DIR="packages/${NAME}"
INFRA_FILE="infra/${NAME}.ts"

if [ -d "$MODULE_DIR" ]; then
  echo "Error: ${MODULE_DIR} already exists"
  exit 1
fi

echo "===> Scaffolding ${NAME}"

# Copy template directory
cp -r templates/s-module "$MODULE_DIR"

# Replace {module} placeholder in all files
# e.g. s-notifications → "notifications" (no prefix) in import paths and names
SHORT="${NAME#s-}"

# macOS sed requires '' after -i
find "$MODULE_DIR" -type f \( -name "*.ts" -o -name "*.json" -o -name "*.md" \) -exec \
  sed -i '' "s/{module}/${SHORT}/g; s/{module-name}/${NAME}/g" {} +

# Create infra stack file from template
cp templates/s-module/infra.ts.template "$INFRA_FILE"
sed -i '' "s/{module}/${SHORT}/g; s/{module-name}/${NAME}/g" "$INFRA_FILE"
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
