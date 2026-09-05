#!/usr/bin/env bash
set -euo pipefail

npm ci --ignore-scripts --no-audit --no-fund
npm run test:booking-email