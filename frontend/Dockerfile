FROM node:20-alpine

WORKDIR /app

# Use the public npm registry so the image builds correctly outside internal environments.
ENV npm_config_registry=https://registry.npmjs.org/
ENV PATH=/app/node_modules/.bin:$PATH

COPY package.json ./

# Install all runtime/frontend dependencies inside the image.
# This guarantees that vite exists at /app/node_modules/.bin/vite.
RUN npm install --include=dev --no-audit --no-fund \
    && npm ls vite

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
