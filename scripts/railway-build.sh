#!/usr/bin/env bash
# Railway build entrypoint — DO NOT inline secrets into railway.toml's buildCommand string.
#
# Why this file exists: Buildkit echoes the literal RUN command it executes into the build
# log, with any inline shell-variable assignment already expanded. `buildCommand =
# "DATABASE_URL=$DATABASE_PUBLIC_URL npm run build"` therefore printed the real Postgres
# connection string (including its password) into every build log since railway.toml was
# added. Assigning the variable INSIDE a script that Buildkit merely invokes by name avoids
# this — the printed RUN step is just "bash scripts/railway-build.sh", never the secret value.
#
# DATABASE_PUBLIC_URL (not DATABASE_URL) on purpose: the build phase can't reach Railway's
# private network (postgres.railway.internal), only the publicly-routable host.
set -euo pipefail
export DATABASE_URL="${DATABASE_PUBLIC_URL:?DATABASE_PUBLIC_URL must be set for the build phase}"
exec npm run build
