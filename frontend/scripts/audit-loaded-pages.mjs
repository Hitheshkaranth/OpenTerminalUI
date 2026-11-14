// Local QC runner. Start the isolated E2E backend/frontend before running.
// Run from the repository root: node frontend/scripts/audit-loaded-pages.mjs
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(repoRoot);
const baseUrl = process.env.QC_BASE_URL || "http://127.0.0.1:5174";
await mkdir("output/page-audit", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const audit = async (page) => {
 const cases=[{"path":"/home","instrument":null},{"path":"/equity/stocks?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/security?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/security/AAPL?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/commodities?symbol=GC%3DF","instrument":"GC=F"},{"path":"/equity/forex?pair=EURUSD","instrument":"EURUSD"},{"path":"/equity/hotlists?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/insider?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/stocks/about?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/dashboard?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/workflows?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/getting-started?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/heatmap?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/dividends?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/rs?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/data-quality?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/screener?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/factors?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/alpha-zoo?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/research-autopilot?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/strategy-export?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/intelligence-timeline?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/portfolio?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/portfolio/lab?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/portfolio/lab/blends?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/mutual-funds?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/bonds?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/watchlist?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/news?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/alerts?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/paper?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/position-sizer?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/journal?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/shadow-account?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/risk?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/correlation?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/stat-lab?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/pair-trading?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/oms?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/ops?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/plugins?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/settings?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/chart-workstation?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/research?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/research-dossiers?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/monitoring?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/mta?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/dom?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/tape?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/launchpad?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/launchpad/popout?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/compare?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/yield-curve?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/bond-analytics?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/option-greeks?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/economics?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/sector-rotation?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/crypto?symbol=BTC-USD","instrument":"BTC-USD"},{"path":"/equity/etf-analytics?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/cockpit?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/saved-views?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/earnings?ticker=AAPL","instrument":"AAPL"},{"path":"/equity/reports?ticker=AAPL","instrument":"AAPL"},{"path":"/fno","instrument":"NIFTY"},{"path":"/fno/greeks?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/futures?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/oi?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/strategy?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/pcr?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/flow?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/heatmap?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/expiry?symbol=NIFTY","instrument":"NIFTY"},{"path":"/fno/about?symbol=NIFTY","instrument":"NIFTY"},{"path":"/backtesting","instrument":null},{"path":"/backtesting/model-lab","instrument":null},{"path":"/backtesting/model-lab/compare","instrument":null},{"path":"/backtesting/model-governance","instrument":null},{"path":"/backtesting/algorithm-framework","instrument":null},{"path":"/backtesting/portfolio-optimizer","instrument":null},{"path":"/account","instrument":null}];
 const results=[];
 await page.setViewportSize({width:1440,height:1000});
 for(const item of cases) {
   const errors=[],failed=[],pending=new Map();
   let lastActivity=Date.now();
   const ignored=/\/api\/(notifications\/unread-count|reports\/market-status|v1\/equity\/overview\/top-tickers|providers\/status)$/;
   const requestPath=request=>{try{return new URL(request.url()).pathname;}catch{return "";}};
   const onRequest=request=>{const path=requestPath(request);if(path.startsWith("/api/")&&!ignored.test(path)&&request.resourceType()!=="websocket"){pending.set(request,path);lastActivity=Date.now();}};
   const onDone=request=>{if(pending.delete(request))lastActivity=Date.now();};
   const onResponse=response=>{if(response.url().includes("/api/")&&response.status()>=400)failed.push({path:new URL(response.url()).pathname,status:response.status()});};
   const onError=error=>errors.push(error.message);
   page.on("request",onRequest);page.on("requestfinished",onDone);page.on("requestfailed",onDone);page.on("response",onResponse);page.on("pageerror",onError);
   const started=Date.now(); let failure=null, settled=false,observed={};
   try {
     await page.goto(baseUrl+item.path,{waitUntil:"domcontentloaded",timeout:20000});
     while(Date.now()-started<90000){
       observed=await page.evaluate(()=>{
         const main=document.querySelector('[class*="relative z-0 min-h-0 min-w-0"]')||document.querySelector("main")||document.querySelector(".ot-route-layer")||document.body;
         const loaders=Array.from(main.querySelectorAll("*")).filter(el=>el.getClientRects().length&&el.children.length===0&&/^(Loading|Fetching|Synchronizing|Restoring|Checking)(\s|\.{3}|…)/i.test(el.textContent.trim())).map(el=>el.textContent.trim()).slice(0,12);
         return {title:document.title,url:location.pathname+location.search,headings:Array.from(main.querySelectorAll("h1,h2,h3")).map(el=>el.textContent).slice(0,25),text:main.innerText.slice(0,12000),overflow:document.documentElement.scrollWidth>innerWidth,loaders,unlabelledButtons:Array.from(main.querySelectorAll("button")).filter(el=>!el.textContent.trim()&&!el.getAttribute("aria-label")&&!el.getAttribute("title")).length};
       });
       const hasRoute=!/^(Loading workspace|Restoring workspace)/i.test((observed.text||"").trim());
       if(Date.now()-started>3000&&hasRoute&&!pending.size&&!observed.loaders.length&&Date.now()-lastActivity>1200){settled=true;break;}
       await page.waitForTimeout(250);
     }
   } catch(error){failure=error.message;}
   const slug=item.path.split("?")[0].replace(/[^a-zA-Z0-9-]/g,"_");
   await page.screenshot({path:"output/page-audit/"+slug+".png",timeout:6000,animations:"disabled"}).catch(()=>{});
   page.off("request",onRequest);page.off("requestfinished",onDone);page.off("requestfailed",onDone);page.off("response",onResponse);page.off("pageerror",onError);
   results.push({...item,...observed,settled,waitPolicy:"initial API requests and visible loading states; 90s deadline",errors,failed,pending:Array.from(pending.values()),waitMs:Date.now()-started,failure});
 }
 return results;
};
  const results = await audit(page);
  for (const row of results) {
    if (row.url?.startsWith("/login")) {
      row.settled = false;
      row.failure = "Protected route redirected to login";
    }
  }
  await writeFile("output/page-audit/reproduced-loaded-pages.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ path, settled, errors, pending, waitMs }) => ({ path, settled, errors, pending, waitMs })), null, 2));
  if (results.some(row => !row.settled || row.failure || row.errors.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
