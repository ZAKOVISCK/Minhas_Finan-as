import bundledFiles from "virtual:minhas-financas-assets";
import { createEmbeddedAssets } from "../lib/embedded-assets.mjs";
import release from "virtual:minhas-financas-release";
import { servePublicAsset } from "../lib/static-http.mjs";
import { secureResponse } from "../lib/security.mjs";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const publicAssets=createEmbeddedAssets(bundledFiles);

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let path:string;try{path=decodeURIComponent(new URL(request.url).pathname);}catch{return secureResponse(new Response('Endereço inválido.',{status:400}));}
    if(!['GET','HEAD'].includes(request.method)) return secureResponse(new Response('Método não permitido.',{status:405,headers:{Allow:'GET, HEAD'}}));
    const asset=await servePublicAsset(request,publicAssets,release.commit);
    if(asset)return asset;
    if(path==='/version.json')return secureResponse(new Response(JSON.stringify(release),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache'}}),release.commit);
    if(!['/','/index.html','/api/data','/api/health'].includes(path)) return secureResponse(new Response('Arquivo não encontrado.',{status:404}));
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return secureResponse(await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)),release.commit);
  },
};
