// Playwright CLI run-code callback. Requires isolated QC frontend on 5174 and backend on 8010.
async (page) => {
  const expect = (target) => ({
  toBeVisible: async () => {await target.waitFor({state:"visible",timeout:15000});},
  toHaveAttribute: async (key,value) => { const actual=await target.getAttribute(key); if(actual!==value) throw new Error(key+" expected "+value+" got "+actual);},
  toContainText: async text => { if(!(await target.textContent()).includes(text)) throw new Error("Missing text "+text);},
  toHaveURL: async pattern => {if(!pattern.test(target.url())) throw new Error("Unexpected URL "+target.url());}
});
  const checks = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5174/equity/workflows");
  await expect(page.getByRole("heading", {name:"Start with a question."})).toBeVisible();
  checks.push("Authenticated workflow route renders");
  await page.getByRole("textbox", {name:"Symbol context",exact:true}).fill("AAPL");
  await page.getByRole("button",{name:"Apply symbol",exact:true}).click();
  await expect(page.getByRole("link",{name:"Open Security Hub",exact:true})).toHaveAttribute("href","/equity/security?ticker=AAPL");
  checks.push("Applied symbol reaches compatible tool URLs");
  await page.getByRole("textbox", {name:"Symbol context",exact:true}).fill("invalid symbol");
  await page.getByRole("button",{name:"Apply symbol",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Enter a symbol");
  checks.push("Invalid symbol rejected");
  await page.getByRole("textbox", {name:"Symbol context",exact:true}).fill("AAPL");
  await page.getByRole("button",{name:"Apply symbol",exact:true}).click();
  await page.getByRole("button",{name:"Macro",exact:true}).click();
  await expect(page.getByRole("article",{name:"Read the macro backdrop steps"})).toBeVisible();
  await page.getByRole("button",{name:"All workflows",exact:true}).click();
  const search = page.getByRole("textbox",{name:"Search workflows and tools"});
  await search.fill("zzzz-no-such-tool");
  await expect(page.getByRole("heading",{name:"No matching workflows",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"No tools match this search",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Clear search",exact:true}).click();
  checks.push("Persona filters and empty search recovery");
  const pin = page.locator(".workflow-pin").first();
  if ((await pin.getAttribute("aria-pressed")) === "false") await pin.click();
  await page.reload();
  await expect(page.locator(".workflow-pin").first()).toHaveAttribute("aria-pressed","true");
  checks.push("Workflow bookmark survives reload");
  const quick = page.getByRole("navigation",{name:"Quick access",exact:true});
  const pinTool = quick.getByRole("button");
  if ((await pinTool.getAttribute("aria-pressed")) === "false") await pinTool.click();
  await page.reload();
  await expect(page.getByRole("navigation",{name:"Quick access",exact:true}).getByRole("button")).toHaveAttribute("aria-pressed","true");
  checks.push("Shared tool favorite survives reload");
  await page.getByRole("combobox",{name:"Command bar",exact:true}).fill("WORKFLOWS");
  await page.getByRole("button",{name:"GO",exact:true}).click();
  await expect(page).toHaveURL(/equity\/workflows/);
  checks.push("Workflow command alias executes");
  await page.setViewportSize({width:1440,height:1100});
  await page.locator(".workflow-hub").evaluate(node=>node.scrollIntoView());
  await page.screenshot({path:"output/playwright/workflow-hub-desktop.png"});
  await page.locator(".workflow-hub").screenshot({path:"output/playwright/workflow-hub-full.png"});
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,main:document.querySelector(".workflow-hub").getBoundingClientRect().width}));
    if(sizes.document>sizes.viewport) throw new Error("Document overflow at "+width+": "+JSON.stringify(sizes));
    await expect(page.getByRole("textbox",{name:"Search workflows and tools"})).toBeVisible();
    checks.push("Responsive "+width+"px: no document overflow; search visible");
    if(width===390) await page.screenshot({path:"output/playwright/workflow-hub-mobile.png"});
  }
  if(errors.length) throw new Error("Runtime errors: "+JSON.stringify(errors));
  checks.push("No uncaught browser runtime errors during functional checks");
  return {checks, errors};
}
