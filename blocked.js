/* TimeLens paused page: shown in place of a site whose daily timer ran out or that Focus mode
   pauses. The worker opens it as blocked.html?u=<the page you were going to>. As soon as the
   site isn't paused any more (timer removed, a break, Focus mode off, midnight) it goes back. */
const target = new URLSearchParams(location.search).get("u") || "";
const domain = domainOf(target);

function show(reason) {
  document.title = `${domain} is paused · TimeLens`;
  $("siteIcon").src = favicon(domain);
  $("siteIcon").hidden = false;
  $("title").textContent = `${domain} is paused`;
  if (reason.kind === "timer") {
    $("why").textContent = `You've used your ${minsLabel(reason.limit / 60)} timer for ${reason.site} today. It resets at midnight.`;
    patch($("actions"), `<button class="primary" data-act="remove">Remove the limit</button>`);
    renderMascot($("mascot"), { mood: "sleep", text: `That's all for ${reason.site} today. See you tomorrow!` });
  } else {
    $("why").textContent = `Focus mode is on, so ${reason.cat} sites are paused.`;
    patch($("actions"), `<div class="chips" role="group" aria-labelledby="breakLabel">
        <span id="breakLabel" class="meta break-label">Take a break</span>${
        BREAK_MINS.map(m => `<button class="chip" data-break="${m}">${m} min</button>`).join("")}</div>
      <button class="quiet" data-act="off">Turn off Focus mode</button>`);
    renderMascot($("mascot"), { mood: "proud", text: "Focus time. This one can wait." });
  }
}

/* asks the worker, which first applies any change you just made, so going back never races
   Chrome's block rules */
async function check() {
  if (!domain) {
    $("why").textContent = "There's no site to go back to. You can close this tab.";
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: "whyPaused", domain }).catch(() => null);
  if (!res) return;   // the worker didn't answer; stay paused and try again on the next change
  if (!res.reason) return location.replace(target);
  show(res.reason);
}

async function update(key, change) {
  const cur = (await chrome.storage.local.get(key))[key];
  await chrome.storage.local.set({ [key]: change(cur) });
}
$("actions").addEventListener("click", e => {
  const b = e.target.closest("[data-act], [data-break]");
  if (!b) return;
  if (b.dataset.break) {
    const until = Date.now() + Number(b.dataset.break) * 60000;
    update("focus", f => ({ ...f, breakUntil: until }));
  } else if (b.dataset.act === "off") {
    update("focus", f => ({ ...f, on: false, breakUntil: null }));
  } else {
    /* the timer that paused this page, which may be on a parent site (youtube.com for m.youtube.com) */
    update("limits", (l = {}) => {
      const site = timerFor(domain, l);
      if (site) delete l[site];
      return l;
    });
  }
});

const requestCheck = scheduler(check);
chrome.storage.onChanged.addListener(requestCheck);
/* midnight changes nothing in storage while you sit here, so look again every minute */
setInterval(() => { if (!document.hidden) requestCheck(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) requestCheck(); });
requestCheck();
