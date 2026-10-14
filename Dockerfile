FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 3000
# O banco (Neon, plano gratuito) pode estar "dormindo" e demorar a responder na
# partida (erro P1002): tenta a migração até 5 vezes, com espera crescente.
CMD ["sh", "-c", "for i in 1 2 3 4 5; do npx prisma migrate deploy && break; echo \"Migração falhou (tentativa $i), tentando de novo em $((i*10))s...\"; [ $i -eq 5 ] && exit 1; sleep $((i*10)); done && npx prisma db seed && node dist/main"]
