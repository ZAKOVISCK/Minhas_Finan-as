import { handleMarketRequest } from '../../../lib/market-http.mjs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleMarketRequest(request);}
export function HEAD(request:Request){return handleMarketRequest(request);}
