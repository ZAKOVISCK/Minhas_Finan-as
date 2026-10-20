import { createMarketService } from './market-server.mjs';
// O fetch do Worker suporta follow/manual, mas não redirect:error do Node.
// Converter para manual e rejeitar 3xx mantém a proibição original de redirecionar.
export async function fetchPublicSource(input, init) {
  try {
    const response=await globalThis.fetch(input,{...init,redirect:init?.redirect==='error'?'manual':init?.redirect});
    if(init?.redirect==='error' && response.status>=300 && response.status<400){
      await response.body?.cancel();
      throw new TypeError('Redirecionamento de fonte pública recusado.');
    }
    return response;
  } catch(error) {
    console.error(JSON.stringify({component:'public-source',host:new URL(input).hostname,error:error?.name,message:String(error?.message||error).slice(0,300)}));
    throw error;
  }
}
export const marketService = createMarketService({fetchImpl:fetchPublicSource});

// Adaptação do transporte Node para Request/Response do Worker; domínio e
// provedores permanecem no módulo original e integral da versão 1.1.0.
export async function handleMarketRequest(request, service = marketService) {
  const url = new URL(request.url);
  const json = (status, body, extra = {}) => new Response(
    request.method === 'HEAD' ? null : JSON.stringify(body),
    {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache','Cross-Origin-Resource-Policy':'same-origin',...extra}}
  );
  if (!['GET','HEAD'].includes(request.method)) return json(405,{error:'Método não permitido.'},{Allow:'GET, HEAD'});
  if (url.pathname === '/api/health') return json(200,{ok:true});
  if (url.pathname !== '/api/data') return json(404,{error:'Endpoint não encontrado.'});
  if (url.searchParams.getAll('feed').length !== 1 || [...url.searchParams.keys()].some(key=>key!=='feed')) return json(400,{error:'Informe somente um parâmetro feed.'});
  try {
    const origin=request.headers.get('Origin');
    if ((origin && new URL(origin).origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json(403,{error:'Consulta permitida somente pela mesma origem.'});
  } catch { return json(403,{error:'Consulta permitida somente pela mesma origem.'}); }
  try {
    const result=await service.getFeed(url.searchParams.get('feed'));
    return json(result.status,result.body,result.retryAfter?{'Retry-After':String(result.retryAfter)}:{});
  } catch { return json(503,{error:'Fonte pública indisponível no momento.'}); }
}
