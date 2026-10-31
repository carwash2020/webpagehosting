for(const k of Object.keys(process.env))if(/proxy/i.test(k))delete process.env[k];
const {chromium}=require('playwright');
module.exports.PAGES={
 'tools-workspace':'/tools/workspace.html','tools-jobs':'/tools/job-tracker.html','tools-invoices':'/tools/invoice-generator.html',
 'portal-dashboard':'/portal/dashboard.html','portal-jobs':'/portal/jobs.html'};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=['x',b64({sub:'00000000-0000-0000-0000-000000000001',role:'authenticated',email:'qa@example.com',exp:Math.floor(Date.now()/1000)+86400,aal:'aal2'}),'sig'];
jwt[0]=b64({alg:'HS256',typ:'JWT'});
const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'qa@example.com',app_metadata:{},user_metadata:{}};
const exp=Math.floor(Date.now()/1000)+86400;
const sess={access_token:jwt.join('.'),refresh_token:'r',expires_at:exp,expires_in:86400,token_type:'bearer',user};
module.exports.seed=async(page)=>{
  await page.goto('http://localhost:8080/404.html');
  await page.evaluate(([s])=>{localStorage.setItem('th_auth_session',JSON.stringify(Object.assign({},s,{remember_until:Date.now()+9e8})));
   localStorage.setItem('sb-csvfqdjuobylgafgolho-auth-token',JSON.stringify(s));localStorage.setItem('th_tools_theme','dark');localStorage.setItem('th_onboarding_v1_seen','1');},[sess]);
};
module.exports.FLAGS=['--no-sandbox','--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1, MAP js.stripe.com 127.0.0.1, MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1, MAP csvfqdjuobylgafgolho.supabase.co 127.0.0.1, MAP r.stripe.com 127.0.0.1, MAP m.stripe.network 127.0.0.1','--ignore-certificate-errors','--no-proxy-server'];
module.exports.chromium=chromium;
