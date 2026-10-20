FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app

# Runtime has no npm dependencies. Copy only application assets and server modules.
COPY --chown=node:node package.json ./*.mjs ./app.js ./styles.css ./index.html ./sw.js ./manifest.webmanifest ./icon.svg ./icon-192.png ./icon-512.png ./

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
