const {PAGES,seed,FLAGS,chromium}=require('./lib');const out=process.argv[2];require('fs').mkdirSync(out,{recursive:true});
(async()=>{const br=await chromium.launch({args:FLAGS});const ctx=await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
const page=await ctx.newPage();await seed(page);
for(const [n,p] of Object.entries(PAGES)){const errs=[];page.removeAllListeners('pageerror');page.on('pageerror',e=>errs.push(e.message));
 await page.goto('http://localhost:8080'+p,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
 await page.screenshot({path:`${out}/${n}.png`});console.log(n,page.url(),errs.slice(0,3));}
await br.close()})();
