import { MEDIA_LIMITS } from './assessment-visual-contract.mjs';
import { Buffer } from 'node:buffer';
const deny=()=>{throw new Error('ASSESSMENT_MEDIA_INVALID');};
const ascii=(b,a,z)=>String.fromCharCode(...b.slice(a,z));

/** Inspect dimensions before allocating decoded pixels. Reject animation and unknown formats. */
export function rasterHeader(bytes) {
  const b=bytes,v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  let mime,width,height;
  if(b.length>=33&&ascii(b,1,4)==='PNG'&&b[0]===137&&v.getUint32(4)===0x0d0a1a0a&&ascii(b,12,16)==='IHDR') {
    mime='image/png';width=v.getUint32(16);height=v.getUint32(20);
    let at=8,ended=false;
    while(at+12<=b.length){const n=v.getUint32(at),type=ascii(b,at+4,at+8);if(n>b.length-at-12||type==='acTL')deny();at+=n+12;if(type==='IEND'){ended=at===b.length;break;}}
    if(!ended)deny();
  }else if(b.length>=12&&ascii(b,0,4)==='RIFF'&&ascii(b,8,12)==='WEBP') {
    if(v.getUint32(4,true)+8!==b.length)deny();
    const type=ascii(b,12,16);
    if(type==='VP8X'&&b.length>=30){if(b[20]&2)deny();width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
    else if(type==='VP8 '&&b.length>=30&&ascii(b,23,26)==='\x9d\x01\x2a'){width=v.getUint16(26,true)&0x3fff;height=v.getUint16(28,true)&0x3fff;}
    else if(type==='VP8L'&&b.length>=25&&b[20]===0x2f){const n=v.getUint32(21,true);width=(n&0x3fff)+1;height=((n>>>14)&0x3fff)+1;}
    else deny();
    mime='image/webp';
  }else if(b.length>=4&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217) {
    mime='image/jpeg';let at=2;
    while(at+4<b.length){if(b[at++]!==255)deny();while(b[at]===255)at++;const marker=b[at++];if(marker===0xda)break;const n=v.getUint16(at);if(n<2||at+n>b.length)deny();if([0xc0,0xc1,0xc2].includes(marker)){height=v.getUint16(at+3);width=v.getUint16(at+5);break;}at+=n;}
  }else deny();
  if(![width,height].every(n=>Number.isInteger(n)&&n>=16&&n<=MEDIA_LIMITS.dimension)||width*height>MEDIA_LIMITS.pixels)deny();
  return {mime_type:mime,width,height};
}

let webpReady;
/** Full decoding, including corrupt compressed streams; pinned codecs, no network at runtime. */
export async function decodeRaster(bytes,mime) {
  let image;
  if(mime==='image/png') {
    const codec=globalThis.Deno?await import('npm:pngjs@7.0.0'):await import('pngjs');
    image=(codec.PNG||codec.default.PNG).sync.read(Buffer.from(bytes),{checkCRC:true});
  }else if(mime==='image/jpeg') {
    const codec=globalThis.Deno?await import('npm:jpeg-js@0.4.4'):await import('jpeg-js');
    image=(codec.decode||codec.default.decode)(bytes,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:8,maxMemoryUsageInMB:80});
  }else {
    const codec=globalThis.Deno?await import('npm:@jsquash/webp@1.5.0/decode.js'):await import('@jsquash/webp/decode.js');
    webpReady ||= (async()=>{
      const path=new URL('./vendor/webp_dec.wasm',import.meta.url);
      const binary=globalThis.Deno?await Deno.readFile(path):await (await import('node:fs/promises')).readFile(path);
      await codec.init(await WebAssembly.compile(binary));
    })();
    await webpReady;image=await codec.default(bytes);
  }
  if(!image||image.data.length!==image.width*image.height*4)deny();
  return {width:image.width,height:image.height};
}

export async function verifyRaster(bytes,asset,decode=decodeRaster) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MEDIA_LIMITS.bytes)deny();
  const h=rasterHeader(bytes);
  if(h.mime_type!==asset.mime_type||h.width!==asset.width||h.height!==asset.height)deny();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==asset.checksum_sha256)deny();
  try{const decoded=await decode(bytes,h.mime_type);if(decoded.width!==h.width||decoded.height!==h.height)deny();}catch{deny();}
  return {checksum_sha256:digest,bytes:bytes.length};
}
