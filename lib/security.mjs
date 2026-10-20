export const SECURITY_HEADERS={
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
 'X-Content-Type-Options':'nosniff',
 'Cross-Origin-Resource-Policy':'same-origin',
 'X-App-Version':'1.2.0',
 'X-App-Upstream-Commit':'0c22b907b2f89c79ceb81d9e414a9cea4b4697f2',
 'Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'Strict-Transport-Security':'max-age=31536000'
};
export function secureResponse(response,sourceCommit){
 const headers=new Headers(response.headers);
 for(const[k,v]of Object.entries(SECURITY_HEADERS))headers.set(k,v);
 if(typeof sourceCommit==='string' && /^[a-f0-9]{40}$/.test(sourceCommit))headers.set('X-App-Source-Commit',sourceCommit);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
