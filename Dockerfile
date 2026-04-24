# Chainguard secure Node base — minimal attack surface, no shell, no package manager
FROM cgr.dev/chainguard/node:latest

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

CMD ["node", "index.js"]
