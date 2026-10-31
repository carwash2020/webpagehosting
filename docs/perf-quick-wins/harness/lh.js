const {PAGES,seed,FLAGS,chromium}=require('./lib');
const fs=require('fs');const label=process.argv[2];const RUNS=+process.argv[3]||3;
(async()=>{
 const {launch}=await import('chrome-launcher');const lighthouse=(await import('lighthouse')).default;
 const chrome=await launch({chromePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',chromeFlags:['--headless=new',...FLAGS]});
 const br=await chromium.connectOverCDP('http://127.0.0.1:'+chrome.port);const ctx=br.contexts()[0];const pg=await ctx.newPage();await seed(pg);await pg.close();
 const res={};
 for(const [n,p] of Object.entries(PAGES)){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;res[n]=[];
  for(let i=0;i<RUNS;i++){
   const r=await lighthouse('http://localhost:8080'+p,{port:chrome.port,output:'json',logLevel:'error',disableStorageReset:true,onlyCategories:['performance']});
   const a=r.lhr.audits;const m=k=>a[k].numericValue;
   res[n].push({score:Math.round(r.lhr.categories.performance.score*100),fcp:m('first-contentful-paint'),lcp:m('largest-contentful-paint'),tbt:m('total-blocking-time'),cls:m('cumulative-layout-shift'),bytes:m('total-byte-weight'),reqs:a['network-requests'].details.items.length,url:r.lhr.finalDisplayedUrl});
  }
  console.log(n,JSON.stringify(res[n].map(x=>[x.score,Math.round(x.lcp),x.url.split('/').pop()])));
 }
 fs.writeFileSync(`${__dirname}/lh-${label}.json`,JSON.stringify(res,null,1));
 await br.close();await chrome.kill();
})();
