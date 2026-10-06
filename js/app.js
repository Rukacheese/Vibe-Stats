(function () {
  "use strict";

  /* ---------- config & constants ---------- */
  const CFG = Object.assign({ title: "Guild Tracker", dataUrl: "data/stats.csv", demoNote: true }, window.GUILD_CONFIG || {});
  const METRICS = {
    power: { label: "Power", agg: "sum" },
    level: { label: "Level", agg: "mean" },
    contribution: { label: "Contribution", agg: "sum" },
    event_score: { label: "Event score", agg: "sum" },
    event_participation: { label: "Event participation", agg: "mean", suffix: "%" }
  };
  const METRIC_KEYS = Object.keys(METRICS);
  const REQUIRED = ["date", "member", "role"].concat(METRIC_KEYS);
  const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
  const SURFACE = "#16171d";

  const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
  const fullFmt = new Intl.NumberFormat("en");
  const fmt = (k, v, full) => {
    if (v == null || isNaN(v)) return "—";
    const m = METRICS[k];
    const n = full ? fullFmt.format(Math.round(v * 10) / 10) : (Math.abs(v) >= 10000 ? compactFmt.format(v) : fullFmt.format(Math.round(v * 10) / 10));
    return n + (m.suffix || "");
  };
  const dateLabel = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const dateLong = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  /* ---------- state ---------- */
  const S = { rows: [], dates: [], members: [], date: null, metric: "power", source: CFG.dataUrl, isDefault: true, a: null, b: null, cmpMetric: "power", chartMetric: "power", query: "" };
  let charts = [];
  const slotOf = new Map(); // member -> color slot (sticky per session)

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row); }
    return rows;
  }

  function toRecords(text) {
    const grid = parseCSV(text);
    if (grid.length < 2) return { error: "The file has no data rows." };
    const head = grid[0].map((x) => x.trim().toLowerCase());
    const missing = REQUIRED.filter((c) => !head.includes(c));
    if (missing.length) return { error: "Missing column(s): " + missing.join(", ") + ". Expected: " + REQUIRED.join(", ") + "." };
    const idx = Object.fromEntries(REQUIRED.map((c) => [c, head.indexOf(c)]));
    const out = [];
    for (let i = 1; i < grid.length; i++) {
      const g = grid[i];
      const date = (g[idx.date] || "").trim();
      const member = (g[idx.member] || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Line " + (i + 1) + ": date must look like 2026-08-10 (got “" + date + "”)." };
      if (!member) return { error: "Line " + (i + 1) + ": member name is empty." };
      const rec = { date, member, role: (g[idx.role] || "").trim() || "Member" };
      for (const k of METRIC_KEYS) {
        const raw = (g[idx[k]] || "").trim();
        const n = Number(raw);
        if (raw === "" || !isFinite(n)) return { error: "Line " + (i + 1) + ": “" + k + "” must be a number (got “" + raw + "”)." };
        rec[k] = n;
      }
      out.push(rec);
    }
    return { rows: out };
  }

  function setData(rows, source, isDefault) {
    S.rows = rows;
    S.dates = [...new Set(rows.map((r) => r.date))].sort();
    S.members = [...new Set(rows.map((r) => r.member))].sort((a, b) => a.localeCompare(b));
    S.source = source;
    S.isDefault = !!isDefault;
    if (!S.dates.includes(S.date)) S.date = S.dates[S.dates.length - 1];
    slotOf.clear();
    const top = ranking(S.date, "power");
    if (!S.members.includes(S.a)) S.a = top[0] ? top[0].member : S.members[0];
    if (!S.members.includes(S.b) || S.b === S.a) S.b = (top[1] ? top[1].member : S.members.find((m) => m !== S.a)) || S.a;
    const sel = document.getElementById("weekSel");
    sel.replaceChildren(...S.dates.slice().reverse().map((d) => h("option", { value: d }, dateLong(d))));
    sel.value = S.date;
  }

  /* ---------- data helpers ---------- */
  const rowAt = (date, member) => S.rows.find((r) => r.date === date && r.member === member);
  const prevDate = (date) => { const i = S.dates.indexOf(date); return i > 0 ? S.dates[i - 1] : null; };

  function ranking(date, metric) {
    const list = S.rows.filter((r) => r.date === date).map((r) => ({ member: r.member, role: r.role, value: r[metric], row: r }));
    list.sort((a, b) => b.value - a.value || a.member.localeCompare(b.member));
    list.forEach((r, i) => (r.rank = i + 1));
    return list;
  }
  function aggregate(date, metric) {
    const vals = S.rows.filter((r) => r.date === date).map((r) => r[metric]);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return METRICS[metric].agg === "sum" ? sum : sum / vals.length;
  }
  function seriesOf(member, metric) {
    return S.dates.map((d) => { const r = rowAt(d, member); return r ? r[metric] : null; });
  }
  function colorFor(member, shown) {
    if (slotOf.has(member)) return SERIES[slotOf.get(member)];
    const used = new Set(shown.filter((m) => slotOf.has(m)).map((m) => slotOf.get(m)));
    let s = 0; while (used.has(s) && s < SERIES.length - 1) s++;
    slotOf.set(member, s);
    return SERIES[s];
  }

  /* ---------- charts ---------- */
  function setupChartDefaults() {
    if (!window.Chart) return;
    const D = Chart.defaults;
    D.color = "#b4b4bd";
    D.font.family = getComputedStyle(document.body).fontFamily;
    D.font.size = 12;
    D.borderColor = "rgba(255,255,255,.08)";
    D.maintainAspectRatio = false;
    D.animation = false;
    D.plugins.legend.labels.usePointStyle = true;
    D.plugins.legend.labels.boxWidth = 8;
    Object.assign(D.plugins.tooltip, { backgroundColor: "#23252e", titleColor: "#ecebe6", bodyColor: "#ecebe6", borderColor: "#3a3d49", borderWidth: 1, padding: 10, boxPadding: 4 });
  }
  const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };
  const tick = (metric) => (v) => (Math.abs(v) >= 10000 ? compactFmt.format(v) : v) + (METRICS[metric].suffix || "");

  function lineChart(canvas, labels, sets, metric) {
    const c = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: sets.map((s) => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
          pointBackgroundColor: s.color, pointBorderColor: SURFACE, pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
          borderWidth: 2, tension: 0.25, spanGaps: true
        }))
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: tick(metric) }, grace: "8%" } },
        plugins: {
          legend: { display: sets.length > 1, position: "top", align: "start" },
          tooltip: { callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + fmt(metric, ctx.parsed.y, true) } }
        }
      }
    });
    charts.push(c);
  }

  function chartCard(title, sub, canvasLabel, opts) {
    const canvas = h("canvas", { role: "img", "aria-label": canvasLabel });
    const card = h("section", { class: "card" + (opts && opts.wide ? " wide" : "") },
      h("h3", {}, title), sub ? h("p", { class: "sub" }, sub) : null,
      h("div", { class: "chart" + (opts && opts.tall ? " tall" : "") }, canvas));
    return { card, canvas };
  }

  /* ---------- views ---------- */
  function viewRankings(root) {
    const m = S.metric, date = S.date, pd = prevDate(date);
    const list = ranking(date, m);
    const prev = pd ? Object.fromEntries(ranking(pd, m).map((r) => [r.member, r])) : {};

    // summary
    let climber = null;
    if (pd) {
      for (const r of ranking(date, "power")) {
        const p = rowAt(pd, r.member);
        if (!p || !p.power) continue;
        const pct = (r.value - p.power) / p.power;
        if (!climber || pct > climber.pct) climber = { member: r.member, pct };
      }
    }
    const power = aggregate(date, "power"), contrib = aggregate(date, "contribution");
    const pPower = pd ? aggregate(pd, "power") : null;
    const strip = h("dl", {},
      h("div", {}, h("dt", {}, "Members"), h("dd", {}, String(list.length))),
      h("div", {}, h("dt", {}, "Guild power"), h("dd", {}, fmt("power", power), pPower ? h("small", { class: pPower <= power ? "up" : "down" }, (power >= pPower ? "▲ +" : "▼ ") + (((power - pPower) / pPower) * 100).toFixed(1) + "% vs last week") : null)),
      h("div", {}, h("dt", {}, "Contribution this week"), h("dd", {}, fmt("contribution", contrib))),
      h("div", {}, h("dt", {}, "Top climber (power)"), h("dd", {}, climber ? climber.member : "—", climber ? h("small", { class: "up" }, "▲ +" + (climber.pct * 100).toFixed(1) + "%") : null)));

    // controls
    const tabs = h("div", { class: "seg", role: "group", "aria-label": "Ranking by" },
      METRIC_KEYS.map((k) => h("button", { type: "button", "aria-pressed": String(k === m), onclick: () => { S.metric = k; render(); } }, METRICS[k].label)));
    const search = h("input", { type: "search", placeholder: "Find a member", "aria-label": "Find a member", value: S.query, oninput: (e) => { S.query = e.target.value; fillRows(); } });

    const max = Math.max(...list.map((r) => r.value), 1);
    const tbody = h("tbody");
    function fillRows() {
      const q = S.query.trim().toLowerCase();
      tbody.replaceChildren(...list.filter((r) => !q || r.member.toLowerCase().includes(q)).map((r) => {
        const p = prev[r.member];
        const diff = p ? r.value - p.value : null;
        const move = p ? p.rank - r.rank : null;
        const href = "#/compare?a=" + encodeURIComponent(r.member);
        return h("tr", { class: r.rank <= 3 ? "top3" : "" },
          h("td", { class: "rank" }, String(r.rank)),
          h("td", { class: "name" }, h("a", { href, title: "Compare " + r.member }, r.member)),
          h("td", { class: "role" }, r.role),
          h("td", { class: "num valcell" }, fmt(m, r.value, true), h("span", { class: "bar", style: "width:" + Math.max(1, (r.value / max) * 100) + "%" })),
          h("td", { class: "num " + (diff == null ? "flat" : diff > 0 ? "up" : diff < 0 ? "down" : "flat") }, diff == null ? "—" : (diff > 0 ? "▲ +" : diff < 0 ? "▼ " : "= ") + fmt(m, Math.abs(diff), false)),
          h("td", { class: "num " + (move == null ? "flat" : move > 0 ? "up" : move < 0 ? "down" : "flat") }, move == null ? "—" : move > 0 ? "▲ " + move : move < 0 ? "▼ " + Math.abs(move) : "="));
      }));
      if (!tbody.children.length) tbody.append(h("tr", {}, h("td", { colspan: 6, class: "empty" }, "No member matches “" + S.query + "”.")));
    }
    fillRows();

    root.append(
      h("h1", {}, "Rankings"),
      h("p", { class: "lede" }, "Week of " + dateLong(date) + ". Pick a statistic to rank members; select a name to compare them with someone else."),
      h("div", { class: "strip" }, strip),
      h("div", { class: "controls" }, tabs, h("span", { class: "spacer" }), search),
      h("div", { class: "table-wrap" }, h("table", {},
        h("caption", { class: "sr", style: "position:absolute;left:-999px" }, "Members ranked by " + METRICS[m].label),
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "#"), h("th", { scope: "col" }, "Member"), h("th", { scope: "col" }, "Role"),
          h("th", { scope: "col", class: "num" }, METRICS[m].label),
          h("th", { scope: "col", class: "num" }, pd ? "Change since " + dateLabel(pd) : "Change"),
          h("th", { scope: "col", class: "num" }, "Rank move"))),
        tbody)));
  }

  function metricSelect(value, onchange, id) {
    return h("label", { class: "field" }, "Statistic",
      h("select", { id, onchange: (e) => onchange(e.target.value) },
        METRIC_KEYS.map((k) => h("option", { value: k, selected: k === value }, METRICS[k].label))));
  }

  function viewCharts(root) {
    const m = S.chartMetric, date = S.date, L = METRICS[m].label;
    root.append(
      h("h1", {}, "Charts"),
      h("p", { class: "lede" }, "How the guild is doing overall and who is leading. The statistic you choose applies to every chart."),
      h("div", { class: "controls" }, metricSelect(m, (v) => { S.chartMetric = v; render(); })));

    const grid = h("div", { class: "grid" });
    root.append(grid);

    // 1. guild over time
    const agg = METRICS[m].agg === "sum" ? "total" : "average";
    const c1 = chartCard("Guild " + agg + " " + L.toLowerCase() + " over time", null, "Line chart of guild " + agg + " " + L + " by week", { wide: true });
    grid.append(c1.card);
    lineChart(c1.canvas, S.dates.map(dateLabel), [{ label: "Guild " + agg, data: S.dates.map((d) => aggregate(d, m)), color: SERIES[0] }], m);

    // 2. top 10 bar
    const top = ranking(date, m).slice(0, 10);
    const c2 = chartCard("Top 10 by " + L.toLowerCase(), "Week of " + dateLong(date), "Bar chart of the top 10 members by " + L);
    grid.append(c2.card);
    charts.push(new Chart(c2.canvas, {
      type: "bar",
      data: { labels: top.map((r) => r.member), datasets: [{ data: top.map((r) => r.value), backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
      options: {
        indexAxis: "y",
        scales: { x: { ticks: { callback: tick(m) }, grid: { color: "rgba(255,255,255,.06)" } }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + fmt(m, ctx.parsed.x, true) } } }
      }
    }));

    // 3. top 5 over time
    const top5 = ranking(date, m).slice(0, 5).map((r) => r.member);
    const c3 = chartCard("Top 5 members over time", "Ranked by " + L.toLowerCase() + " in the selected week", "Line chart of the top 5 members by " + L + " by week");
    grid.append(c3.card);
    lineChart(c3.canvas, S.dates.map(dateLabel), top5.map((n) => ({ label: n, data: seriesOf(n, m), color: colorFor(n, top5) })), m);

    // 4. distribution
    const vals = ranking(date, m).map((r) => r.value);
    const lo = Math.min(...vals), hi = Math.max(...vals), bins = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(vals.length))));
    const w = (hi - lo) / bins || 1;
    const counts = new Array(bins).fill(0);
    vals.forEach((v) => { counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; });
    const lbl = counts.map((_, i) => compactFmt.format(lo + i * w) + "–" + compactFmt.format(lo + (i + 1) * w));
    const c4 = chartCard("How members are spread out", "Number of members per " + L.toLowerCase() + " range", "Histogram of members by " + L + " range");
    grid.append(c4.card);
    charts.push(new Chart(c4.canvas, {
      type: "bar",
      data: { labels: lbl, datasets: [{ data: counts, backgroundColor: SERIES[2], borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 40 }] },
      options: {
        scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 }, beginAtZero: true } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => it[0].label, label: (ctx) => " " + ctx.parsed.y + (ctx.parsed.y === 1 ? " member" : " members") } } }
      }
    }));
  }

  function viewCompare(root) {
    const date = S.date, A = S.a, B = S.b;
    const memberSel = (label, value, set) => h("label", { class: "field" }, label,
      h("select", { onchange: (e) => { set(e.target.value); syncHash(); render(); } },
        S.members.map((n) => h("option", { value: n, selected: n === value }, n))));
    root.append(
      h("h1", {}, "Compare members"),
      h("p", { class: "lede" }, "Put two members side by side for the week of " + dateLong(date) + "."),
      h("div", { class: "controls" },
        memberSel("Member A", A, (v) => (S.a = v)),
        memberSel("Member B", B, (v) => (S.b = v)),
        metricSelect(S.cmpMetric, (v) => { S.cmpMetric = v; render(); })));

    if (A === B) root.append(h("p", { class: "msg" }, "Both selections are the same member. Choose two different members to see a comparison."));

    const ra = rowAt(date, A), rb = rowAt(date, B);
    if (!ra || !rb) {
      root.append(h("p", { class: "msg err" }, (!ra ? A : B) + " has no data for the week of " + dateLong(date) + ". Pick another week or member."));
      return;
    }
    const rk = {}; METRIC_KEYS.forEach((k) => (rk[k] = Object.fromEntries(ranking(date, k).map((r) => [r.member, r.rank]))));

    const who = (n, c) => h("span", { class: "who" }, h("span", { class: "dot", style: "background:" + c }), n);
    const body = METRIC_KEYS.map((k) => {
      const va = ra[k], vb = rb[k], gap = va - vb;
      const cell = (v, r, lead) => h("td", { class: "num", style: lead ? "font-weight:600" : "" }, fmt(k, v, true), h("span", { class: "role" }, "  #" + r));
      return h("tr", {}, h("td", {}, METRICS[k].label), cell(va, rk[k][A], va > vb), cell(vb, rk[k][B], vb > va),
        h("td", { class: "num" }, gap === 0 ? "Equal" : h("span", { class: "who" }, h("span", { class: "dot", style: "background:" + (gap > 0 ? SERIES[0] : SERIES[1]) }), (gap > 0 ? A : B) + " leads by " + fmt(k, Math.abs(gap), true))));
    });
    root.append(h("div", { class: "table-wrap", style: "margin-bottom:16px" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Statistic"),
        h("th", { scope: "col", class: "num" }, who(A, SERIES[0])), h("th", { scope: "col", class: "num" }, who(B, SERIES[1])), h("th", { scope: "col", class: "num" }, "Difference"))),
      h("tbody", {}, body))));

    const grid = h("div", { class: "grid" });
    root.append(grid);
    const m = S.cmpMetric;
    const c1 = chartCard(METRICS[m].label + " over time", null, "Line chart comparing " + A + " and " + B + " on " + METRICS[m].label);
    grid.append(c1.card);
    lineChart(c1.canvas, S.dates.map(dateLabel), [{ label: A, data: seriesOf(A, m), color: SERIES[0] }, { label: B, data: seriesOf(B, m), color: SERIES[1] }], m);

    const maxes = {}; METRIC_KEYS.forEach((k) => (maxes[k] = Math.max(...ranking(date, k).map((r) => r.value)) || 1));
    const c2 = chartCard("Overall profile", "Each axis is shown as a percentage of the guild’s best value this week", "Radar chart comparing " + A + " and " + B + " across all statistics");
    grid.append(c2.card);
    const radarSet = (n, row, c) => ({ label: n, data: METRIC_KEYS.map((k) => Math.round((row[k] / maxes[k]) * 1000) / 10), borderColor: c, backgroundColor: c + "33", pointBackgroundColor: c, pointBorderColor: SURFACE, borderWidth: 2, pointRadius: 4 });
    charts.push(new Chart(c2.canvas, {
      type: "radar",
      data: { labels: METRIC_KEYS.map((k) => METRICS[k].label), datasets: [radarSet(A, ra, SERIES[0]), radarSet(B, rb, SERIES[1])] },
      options: {
        scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: "rgba(255,255,255,.1)" }, angleLines: { color: "rgba(255,255,255,.1)" }, pointLabels: { color: "#b4b4bd", font: { size: 12 } } } },
        plugins: { legend: { position: "top", align: "start" }, tooltip: { callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + ctx.parsed.r + "% of guild best" } } }
      }
    }));
  }

  function viewData(root) {
    const msg = h("div", { id: "dataMsg" });
    const file = h("input", { type: "file", accept: ".csv,text/csv", id: "csvFile", hidden: true, onchange: (e) => e.target.files[0] && readFile(e.target.files[0]) });
    const drop = h("div", { class: "drop", id: "drop" },
      h("p", { style: "margin:0 0 10px" }, "Drop a CSV file here to preview it on this device."),
      h("button", { class: "btn primary", type: "button", onclick: () => file.click() }, "Choose a CSV file"), file);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));

    function readFile(f) {
      const rd = new FileReader();
      rd.onload = () => {
        const res = toRecords(String(rd.result));
        if (res.error) { msg.replaceChildren(h("p", { class: "msg err" }, res.error)); return; }
        setData(res.rows, "Local file: " + f.name, false);
        render();
        document.getElementById("dataMsg").replaceChildren(h("p", { class: "msg ok" }, "Loaded " + res.rows.length + " rows from " + f.name + ". This is a preview only; nothing is saved or published."));
      };
      rd.readAsText(f);
    }

    const template = () => {
      const txt = REQUIRED.join(",") + "\n2026-10-05,Aldric,Leader,7500000,52,9800,84000,92\n2026-10-05,Brynja,Officer,6100000,49,7600,61000,75\n";
      const a = h("a", { href: URL.createObjectURL(new Blob([txt], { type: "text/csv" })), download: "stats-template.csv" });
      document.body.append(a); a.click(); a.remove();
    };

    const latest = S.rows.filter((r) => r.date === S.dates[S.dates.length - 1]).length;
    const recent = S.rows.slice().sort((a, b) => b.date.localeCompare(a.date) || a.member.localeCompare(b.member)).slice(0, 200);
    root.append(
      h("h1", {}, "Data"),
      h("p", { class: "lede" }, "Everything on this site is computed from one CSV file. Add a block of rows each week, one per member."),
      msg,
      h("div", { class: "strip" }, h("dl", {},
        h("div", {}, h("dt", {}, "Source"), h("dd", { style: "font-size:16px;word-break:break-all" }, S.source)),
        h("div", {}, h("dt", {}, "Rows"), h("dd", {}, fullFmt.format(S.rows.length))),
        h("div", {}, h("dt", {}, "Weeks"), h("dd", {}, String(S.dates.length), h("small", {}, dateLabel(S.dates[0]) + " to " + dateLabel(S.dates[S.dates.length - 1])))),
        h("div", {}, h("dt", {}, "Members in latest week"), h("dd", {}, String(latest))))),
      h("div", { class: "grid" },
        h("section", { class: "card" }, h("h2", {}, "Update the site"),
          h("ol", { class: "steps" },
            h("li", {}, "Download the template and add one row per member for the new week."),
            h("li", {}, "Use the same column names and dates written as YYYY-MM-DD."),
            h("li", {}, "In your GitHub repository, open data/stats.csv, paste the new rows at the end and commit."),
            h("li", {}, "GitHub Pages redeploys in about a minute.")),
          h("button", { class: "btn", type: "button", onclick: template }, "Download CSV template")),
        h("section", { class: "card" }, h("h2", {}, "Preview a file"), h("p", { class: "lede", style: "margin-bottom:12px" }, "Check a file before you publish it. Errors tell you which line to fix."), drop)),
      h("h2", { style: "margin-top:28px" }, "Latest rows"),
      h("div", { class: "table-wrap", style: "max-height:420px;overflow:auto" }, h("table", {},
        h("thead", {}, h("tr", {}, REQUIRED.map((c) => h("th", { scope: "col", class: METRIC_KEYS.includes(c) ? "num" : "" }, c)))),
        h("tbody", {}, recent.map((r) => h("tr", {}, REQUIRED.map((c) => h("td", { class: METRIC_KEYS.includes(c) ? "num" : "" }, METRIC_KEYS.includes(c) ? fullFmt.format(r[c]) : r[c]))))))));
  }

  /* ---------- router ---------- */
  const ROUTES = { rankings: viewRankings, charts: viewCharts, compare: viewCompare, data: viewData };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    return { route: ROUTES[path] ? path : "rankings", params: new URLSearchParams(qs || "") };
  }
  function syncHash() {
    const next = "#/compare?a=" + encodeURIComponent(S.a) + "&b=" + encodeURIComponent(S.b);
    if (parseHash().route === "compare") history.replaceState(null, "", next);
  }

  function render() {
    const { route } = parseHash();
    destroyCharts();
    document.querySelectorAll("#nav a").forEach((a) => (a.getAttribute("data-route") === route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const root = document.getElementById("view");
    root.replaceChildren();
    if (!S.rows.length) return;
    ROUTES[route](root);
  }

  function showFatal(text) {
    document.getElementById("view").replaceChildren(
      h("h1", {}, "Can’t load the data"),
      h("p", { class: "msg err" }, text),
      h("p", { class: "lede" }, "If you opened index.html straight from your computer, browsers block reading the CSV. Publish with GitHub Pages, or run a local server from the project folder (python3 -m http.server)."));
  }

  window.addEventListener("hashchange", () => {
    const { route, params } = parseHash();
    if (route === "compare") {
      if (params.get("a") && S.members.includes(params.get("a"))) S.a = params.get("a");
      if (params.get("b") && S.members.includes(params.get("b"))) S.b = params.get("b");
      if (S.a === S.b) S.b = S.members.find((n) => n !== S.a) || S.b;
    }
    render();
    window.scrollTo(0, 0);
  });

  document.getElementById("weekSel").addEventListener("change", (e) => { S.date = e.target.value; render(); });

  /* ---------- boot ---------- */
  document.title = CFG.title;
  document.getElementById("brand").textContent = CFG.title;
  if (!CFG.demoNote) document.getElementById("foot-note").remove();
  setupChartDefaults();

  fetch(CFG.dataUrl, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("Could not fetch " + CFG.dataUrl + " (" + r.status + ")."); return r.text(); })
    .then((t) => {
      const res = toRecords(t);
      if (res.error) throw new Error(res.error);
      setData(res.rows, CFG.dataUrl, true);
      const { route, params } = parseHash();
      if (route === "compare") {
        if (S.members.includes(params.get("a"))) S.a = params.get("a");
        if (S.members.includes(params.get("b"))) S.b = params.get("b");
      }
      render();
    })
    .catch((e) => showFatal(e.message));
})();
