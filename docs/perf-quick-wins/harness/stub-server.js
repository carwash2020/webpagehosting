// Serves the repo over http:8080 and stubbed third parties over https:443 (hosts mapped to 127.0.0.1 by Chrome).
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(process.argv[2]), H=__dirname;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.ttf':'font/ttf'};
const zlib=require('zlib');
function send(req,res,code,type,body,extra={}){
  const ae=req.headers['accept-encoding']||''; let b=Buffer.isBuffer(body)?body:Buffer.from(body);
  const h={'content-type':type,'access-control-allow-origin':'*','cache-control':'public, max-age=600',...extra};
  if(/text|javascript|json|svg/.test(type)&&ae.includes('gzip')){b=zlib.gzipSync(b);h['content-encoding']='gzip';}
  res.writeHead(code,h);res.end(req.method==='HEAD'?undefined:b);
}
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  // Resolve against the root and refuse anything that lands outside it (../, absolute paths, NUL bytes).
  const f=path.resolve(ROOT,'.'+path.posix.normalize('/'+p)); const rel=path.relative(ROOT,f);
  if(p.includes('\0')||rel.startsWith('..')||path.isAbsolute(rel)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  send(req,res,200,mime[path.extname(f)]||'application/octet-stream',fs.readFileSync(f));
}).listen(8080);
const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'qa@example.com',app_metadata:{},user_metadata:{}};
const fontmap=Object.fromEntries(fs.readFileSync(H+'/fontmap.txt','utf8').trim().split('\n').map(l=>l.split(' ')));
const fontFiles=new Set(Object.values(fontmap));
let css=fs.readFileSync(H+'/fonts.css','utf8'); for(const [u,f] of Object.entries(fontmap)) css=css.split(u).join('https://fonts.gstatic.com/_/'+f);
https.createServer({key:fs.readFileSync(H+'/k.pem'),cert:fs.readFileSync(H+'/c.pem')},(req,res)=>{
  const host=req.headers.host.split(':')[0], u=req.url;
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'});return res.end();}
  if(host==='cdn.jsdelivr.net'){
    if(u.includes('supabase-js'))return send(req,res,200,'text/javascript',fs.readFileSync(H+'/node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    if(u.includes('jspdf'))return send(req,res,200,'text/javascript',fs.readFileSync(H+'/node_modules/jspdf/dist/jspdf.umd.min.js'));
    return send(req,res,200,'text/javascript','/* stub */');
  }
  if(host==='js.stripe.com')return send(req,res,200,'text/javascript',fs.readFileSync(H+'/stripe-stub.js'));
  if(host==='fonts.googleapis.com')return send(req,res,200,'text/css',css);
  if(host==='fonts.gstatic.com'){
    // Only serve files named in fontmap.txt -- the request path is never used to build a file path.
    const f=decodeURIComponent(u.split('?')[0]).split('/').pop();
    if(!fontFiles.has(f)){res.writeHead(404);return res.end('nf');}
    return send(req,res,200,'font/woff2',fs.readFileSync(path.join(H,'fonts',f)));
  }
  if(host.endsWith('supabase.co')){
    const j=(o,x={})=>send(req,res,200,'application/json',JSON.stringify(o),{'cache-control':'no-store',...x});
    if(u.startsWith('/auth/v1/user'))return j(user);
    if(u.includes('/auth/v1/token'))return j({access_token:'a.b.c',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user});
    if(u.includes('internal_mfa_session_status'))return j({aal:'aal2',required:false,verified:true,ok:true});
    if(u.startsWith('/rest/v1/rpc'))return j([]);
    if(u.startsWith('/rest/v1'))return j([],{'content-range':'*/0'});
    return j({});
  }
  send(req,res,200,'text/plain','');
}).listen(443);
console.log('up');
