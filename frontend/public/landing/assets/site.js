// Shared behaviour for every page of the OpenTerminalUI site.
(() => {
  const $ = s => document.querySelector(s);

  // Inside the app (served by the backend) "Get started" opens the terminal; on the public site it goes to Deploy.
  if (!/github\.io$/.test(location.hostname) && location.protocol !== "file:") {
    document.querySelectorAll("[data-launch]").forEach(a => { a.href = "/login"; a.textContent = "Launch terminal →"; });
  }

  const nav = $("#nav");
  if (nav) addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });

  // GitHub stars (unauthenticated, best effort)
  const stars = $("#stars");
  if (stars) fetch("https://api.github.com/repos/Hitheshkaranth/OpenTerminalUI").then(r => r.ok ? r.json() : null)
    .then(j => { if (j && j.stargazers_count != null) stars.textContent = "★ " + j.stargazers_count.toLocaleString(); })
    .catch(() => {});

  document.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "copied"; }
    catch { b.textContent = "select + copy"; }
    setTimeout(() => (b.textContent = "copy"), 1600);
  }));

  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".rv").forEach((el, i) => { el.style.transitionDelay = (i % 4) * 60 + "ms"; io.observe(el); });
})();
