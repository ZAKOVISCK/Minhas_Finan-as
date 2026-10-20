import {writeFileSync} from "node:fs";
// Code-native rendering of the wallet mark in public/icon.svg. No external dependencies.
const createBrandPng=(function createBrandPng(size){
 const green=[8,124,102,255],white=[255,255,255,255],mint=[184,239,207,255],clear=[0,0,0,0];
 const rr=(x,y,l,t,w,h,r)=>{const a=Math.abs(x-(l+w/2))-(w/2-r),b=Math.abs(y-(t+h/2))-(h/2-r);return Math.hypot(Math.max(a,0),Math.max(b,0))+Math.min(Math.max(a,b),0)-r;};
 const line=(x,y,ax,ay,bx,by,r)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-ax-t*dx,y-ay-t*dy)<=r;};
 const sample=(x,y)=>{
  let c=rr(x,y,0,0,64,64,16)<=0?green:clear;
  if(line(x,y,16,23,37,16,1.6)||line(x,y,37,16,43,21,1.6))c=white;
  if(Math.abs(rr(x,y,13,23,38,27,7))<=1.6)c=white;
  if(rr(x,y,36,31,17,11,4)<=0)c=mint;
  if(Math.hypot(x-43,y-36.5)<=1.7)c=green;
  if(line(x,y,21,40,26,34,1.15)||line(x,y,26,34,31,37,1.15))c=white;
  return c;
 };
 const palette=[],ids=new Map(),rows=[];
 for(let y=0;y<size;y++){rows.push(0);for(let x=0;x<size;x++){
  let r=0,g=0,b=0,a=0;
  for(const sy of [.25,.75])for(const sx of [.25,.75]){const c=sample((x+sx)*64/size,(y+sy)*64/size);if(c[3]){r+=c[0];g+=c[1];b+=c[2];a++;}}
  const rgba=a?[Math.round(r/a),Math.round(g/a),Math.round(b/a),Math.round(a*255/4)]:clear,key=rgba.join(",");
  if(!ids.has(key)){ids.set(key,palette.length);palette.push(rgba);}
  rows.push(ids.get(key));
 }}
 if(palette.length>256)throw Error("Palette too large");
 const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(type,bytes)=>{const d=[...Array.from(type,c=>c.charCodeAt(0)),...bytes];return [...u32(bytes.length),...d,...u32(crc(d))];};
 const compressed=[0x78,0x01];
 for(let off=0;off<rows.length;off+=65535){const n=Math.min(65535,rows.length-off),last=off+n===rows.length;compressed.push(last?1:0,n&255,n>>>8,(~n)&255,((~n)>>>8)&255);for(let i=off;i<off+n;i++)compressed.push(rows[i]);}
 let aa=1,bb=0;for(const v of rows){aa=(aa+v)%65521;bb=(bb+aa)%65521;}compressed.push(...u32(((bb<<16)|aa)>>>0));
 const out=[137,80,78,71,13,10,26,10];
 for(const bytes of [chunk("IHDR",[...u32(size),...u32(size),8,3,0,0,0]),chunk("PLTE",palette.flatMap(x=>x.slice(0,3))),chunk("tRNS",palette.map(x=>x[3])),chunk("IDAT",compressed),chunk("IEND",[])])for(const b of bytes)out.push(b);
 return out;
});
for(const size of [192,512])writeFileSync(new URL("../public/icon-"+size+".png",import.meta.url),new Uint8Array(createBrandPng(size)));
