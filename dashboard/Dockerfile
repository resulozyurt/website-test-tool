# Dashboard image — read-only Next.js panel (a real web service).
#
# Reads the same Railway Postgres the runner writes to and never mutates it.
# Basic Auth (DASHBOARD_USER / DASHBOARD_PASSWORD) is enforced in middleware.ts.
# Railway sets the Root Directory of this service to `dashboard/`, so this
# Dockerfile and dashboard/railway.json are resolved relative to that folder.
FROM node:20-slim AS build
WORKDIR /app

# Install all deps (dev included) so `next build` can run.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; bind Next to it on all interfaces.
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
