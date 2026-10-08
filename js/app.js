(function () {
  "use strict";

  /* ---------- config & constants ---------- */
  const CFG = Object.assign({ title: "Guild Tracker", membersUrl: "data/members.csv", guildUrl: "data/guild.csv", statsUrl: "data/stats.csv" }, window.GUILD_CONFIG || {});

  // Every statistic the site knows about. Only those present in the CSV are shown.
  const METRICS = {
    power: { label: "Power", group: "Overall" },
    level: { label: "Level", group: "Overall" },
    contribution: { label: "Contribution", group: "Overall" },
    contribution_total: { label: "Total contribution", group: "Overall" },
    class_level: { label: "Class level", group: "Overall" },
    atk: { label: "ATK", group: "Combat" },
    def: { label: "DEF", group: "Combat" },
    hp: { label: "HP", group: "Combat" },
    spd: { label: "SPD", group: "Combat" },
    equip: { label: "Equipment (median)", group: "Gear", derived: true },
    tech: { label: "Techniques (median)", group: "Gear", derived: true },
    charm: { label: "Charms (median)", group: "Gear", derived: true },
    event_score: { label: "Event score", group: "Events" }
  };
  const GEAR = {
    equip: ["weapon", "second_hand", "helmet", "chestplate", "boots"],
    tech: ["technique_1", "technique_2", "technique_3", "technique_4"],
    charm: ["charm_1", "charm_2", "charm_3", "charm_4"]
  };
  const GEAR_TITLES = { equip: "Equipment", tech: "Techniques", charm: "Charms" };
  const GEAR_LABELS = {
    weapon: "Weapon", second_hand: "Second hand", helmet: "Helmet", chestplate: "Chestplate", boots: "Boots",
    technique_1: "Technique 1", technique_2: "Technique 2", technique_3: "Technique 3", technique_4: "Technique 4",
    charm_1: "Charm 1", charm_2: "Charm 2", charm_3: "Charm 3", charm_4: "Charm 4"
  };
  const GEAR_COLS = [].concat(GEAR.equip, GEAR.tech, GEAR.charm);
  const BASE_NUM = Object.keys(METRICS).filter((k) => !METRICS[k].derived);
  const MEMBER_NUM = BASE_NUM.concat(GEAR_COLS);
  const GUILD_NUM = ["guild_level", "members", "guild_power", "activeness", "floor", "boss_hp_remaining_pct", "rank", "ranked_floor", "boss_damage_pct"];
  const MEMBER_HEADER = ["date", "member", "player_id", "role", "power", "level", "contribution", "contribution_total", "class", "class_level", "atk", "def", "hp", "spd"].concat(GEAR_COLS);
  const GUILD_HEADER = ["date", "guild", "guild_level", "members", "guild_power", "activeness", "floor", "boss_hp_remaining_pct", "relation", "rank", "ranked_guild", "ranked_floor", "boss_damage_pct"];
  const STATS_HEADER = ["date", "member", "role", "power", "level", "contribution", "event_score"];
  const RADAR = ["power", "level", "contribution", "atk", "def", "hp", "spd", "equip"];

  const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
  const SURFACE = "#16171d";

  const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
  const fullFmt = new Intl.NumberFormat("en");
  const fmt = (k, v, full) => {
    if (v == null || isNaN(v)) return "—";
    const m = METRICS[k] || {};
    const r = Math.round(v * 10) / 10;
    const n = full || Math.abs(v) < 10000 ? fullFmt.format(r) : compactFmt.format(v);
    return n + (m.suffix || "");
  };
  const dateLabel = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const dateLong = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const medianOf = (arr) => {
    const a = arr.filter((v) => v != null && !isNaN(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const quantile = (sorted, q) => {
    const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  };

  /* ---------- state ---------- */
  const S = {
    rows: [], byDate: new Map(), dates: [], members: [], metrics: [], memberSource: "",
    guild: [], guildSource: "", guildError: "",
    membersRaw: [], statsRaw: null, statsSource: "", statsError: "", statsNotes: [], issuesCache: null,
    date: null, metric: "power", chartMetric: "power", cmpMetric: "power",
    a: null, b: null, profile: null, query: "", classFilter: ""
  };
  let charts = [];
  const slotOf = new Map();

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

  function readNumber(g, ix, col, line, rec) {
    const raw = (g[ix] || "").trim();
    if (raw === "") { rec[col] = null; return null; }
    const n = Number(raw);
    if (!isFinite(n)) return "Line " + line + ": “" + col + "” must be a number (got “" + raw + "”).";
    rec[col] = n;
    return null;
  }

  function toMembers(text) {
    const grid = parseCSV(text);
    if (grid.length < 2) return { error: "The file has no data rows." };
    const head = grid[0].map((x) => x.trim().toLowerCase());
    if (!head.includes("date") || !head.includes("member")) return { error: "The first line must include the columns date and member." };
    if (!BASE_NUM.some((c) => head.includes(c))) return { error: "No statistic columns found. Expected at least one of: " + BASE_NUM.join(", ") + "." };
    const ix = (c) => head.indexOf(c);
    const numCols = MEMBER_NUM.filter((c) => head.includes(c));
    const seen = new Set(), out = [];
    for (let i = 1; i < grid.length; i++) {
      const g = grid[i], line = i + 1;
      const date = (g[ix("date")] || "").trim();
      const member = (g[ix("member")] || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Line " + line + ": date must look like 2026-10-05 (got “" + date + "”)." };
      if (!member) return { error: "Line " + line + ": member name is empty." };
      const key = date + "|" + member;
      if (seen.has(key)) return { error: "Line " + line + ": " + member + " appears twice for " + date + "." };
      seen.add(key);
      const rec = {
        date, member,
        role: ix("role") >= 0 ? (g[ix("role")] || "").trim() || "Member" : "Member",
        class: ix("class") >= 0 ? (g[ix("class")] || "").trim() : ""
      };
      for (const c of numCols) { const err = readNumber(g, ix(c), c, line, rec); if (err) return { error: err }; }
      for (const k of Object.keys(GEAR)) rec[k] = medianOf(GEAR[k].map((c) => rec[c]));
      out.push(rec);
    }
    return { rows: out };
  }

  function toGuild(text) {
    const grid = parseCSV(text);
    if (grid.length < 2) return { error: "The file has no data rows." };
    const head = grid[0].map((x) => x.trim().toLowerCase());
    const need = ["date", "relation", "rank", "ranked_guild", "ranked_floor"];
    const missing = need.filter((c) => !head.includes(c));
    if (missing.length) return { error: "Missing column(s): " + missing.join(", ") + "." };
    const ix = (c) => head.indexOf(c);
    const out = [];
    for (let i = 1; i < grid.length; i++) {
      const g = grid[i], line = i + 1;
      const date = (g[ix("date")] || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Line " + line + ": date must look like 2026-10-05 (got “" + date + "”)." };
      const rec = {
        date,
        guild: ix("guild") >= 0 ? (g[ix("guild")] || "").trim() : "",
        relation: (g[ix("relation")] || "").trim().toLowerCase(),
        ranked_guild: (g[ix("ranked_guild")] || "").trim()
      };
      for (const c of GUILD_NUM.filter((x) => head.includes(x))) { const err = readNumber(g, ix(c), c, line, rec); if (err) return { error: err }; }
      out.push(rec);
    }
    return { rows: out };
  }

  /* ---------- data helpers ---------- */
  function setMembers(rows, source) {
    S.issuesCache = null;
    S.rows = rows;
    S.byDate = new Map();
    rows.forEach((r) => { if (!S.byDate.has(r.date)) S.byDate.set(r.date, []); S.byDate.get(r.date).push(r); });
    S.dates = [...S.byDate.keys()].sort();
    S.members = [...new Set(rows.map((r) => r.member))].sort((a, b) => a.localeCompare(b));
    S.metrics = Object.keys(METRICS).filter((k) => rows.some((r) => r[k] != null));
    S.memberSource = source;
    if (!S.dates.includes(S.date)) S.date = S.dates[S.dates.length - 1];
    const first = S.metrics.includes("power") ? "power" : S.metrics[0];
    ["metric", "chartMetric", "cmpMetric"].forEach((k) => { if (!S.metrics.includes(S[k])) S[k] = first; });
    slotOf.clear();
    const top = ranking(S.date, S.metric);
    if (!S.members.includes(S.a)) S.a = top[0] ? top[0].member : S.members[0];
    if (!S.members.includes(S.b) || S.b === S.a) S.b = (top[1] ? top[1].member : S.members.find((m) => m !== S.a)) || S.a;
    if (!S.members.includes(S.profile)) S.profile = top[0] ? top[0].member : S.members[0];
    const sel = document.getElementById("weekSel");
    sel.replaceChildren(...S.dates.slice().reverse().map((d) => h("option", { value: d }, dateLong(d))));
    sel.value = S.date;
    document.getElementById("foot-note").textContent = "Latest data: " + dateLong(S.dates[S.dates.length - 1]) + ".";
  }

  function setGuild(rows, source) {
    S.issuesCache = null;
    S.guild = rows;
    S.guildSource = source;
    S.guildError = "";
  }

  /* ---------- optional stats file ---------- */
  // The stats file repeats the basic columns (power, level, contribution) and may carry the
  // event columns. It never overrides the members file: it only fills blank event cells, and
  // every disagreement is listed on the Data page.
  const normName = (n) => n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const STATS_FILL = ["event_score"];
  const STATS_COMPARE = ["power", "level", "contribution"];

  function mergeStats(rows, stats) {
    const notes = [], note = (date, where, text) => notes.push({ date, where, text });
    const byDate = new Map();
    rows.forEach((r) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); });
    const taken = new Set();
    stats.forEach((s) => {
      const pool = (byDate.get(s.date) || []).filter((m) => !taken.has(m));
      let m = pool.find((x) => normName(x.member) === normName(s.member));
      if (!m && s.power != null) {
        const same = pool.filter((x) => x.power === s.power);
        if (same.length === 1) m = same[0];
      }
      if (!m) { note(s.date, s.member, "Listed in the stats file but not found in the members file for this week."); return; }
      taken.add(m);
      if (m.member !== s.member) note(s.date, m.member, "Spelled “" + s.member + "” in the stats file.");
      STATS_COMPARE.forEach((k) => {
        if (s[k] != null && m[k] != null && s[k] !== m[k]) note(s.date, m.member, METRICS[k].label + " is " + fullFmt.format(s[k]) + " in the stats file but " + fullFmt.format(m[k]) + " in the members file. The members file is used.");
      });
      if (s.role && m.role && s.role !== m.role) note(s.date, m.member, "Role is " + s.role + " in the stats file but " + m.role + " in the members file. The members file is used.");
      STATS_FILL.forEach((k) => {
        if (s[k] == null) return;
        if (m[k] == null) m[k] = s[k];
        else if (m[k] !== s[k]) note(s.date, m.member, METRICS[k].label + " differs between the two files. The members file is used.");
      });
    });
    return notes;
  }

  // Rebuilds the member rows from the two raw files, so a preview never stacks on an earlier one.
  function rebuild() {
    const rows = S.membersRaw.map((r) => Object.assign({}, r));
    S.statsNotes = S.statsRaw ? mergeStats(rows, S.statsRaw) : [];
    setMembers(rows, S.memberSource);
  }
  function loadMembers(raw, source) { S.membersRaw = raw; S.memberSource = source; rebuild(); }
  function loadStats(raw, source) { S.statsRaw = raw; S.statsSource = source; S.statsError = ""; rebuild(); }

  const rowAt = (date, member) => (S.byDate.get(date) || []).find((r) => r.member === member);
  const prevDate = (date) => { const i = S.dates.indexOf(date); return i > 0 ? S.dates[i - 1] : null; };
  const multi = () => S.dates.length > 1;

  function ranking(date, metric) {
    const list = (S.byDate.get(date) || []).filter((r) => r[metric] != null)
      .map((r) => ({ member: r.member, role: r.role, cls: r.class, value: r[metric], row: r }));
    list.sort((a, b) => b.value - a.value || a.member.localeCompare(b.member));
    list.forEach((r, i) => (r.rank = i + 1));
    return list;
  }
  const rankMap = (date, metric) => Object.fromEntries(ranking(date, metric).map((r) => [r.member, r.rank]));
  function percentile(date, metric, v) {
    const vals = (S.byDate.get(date) || []).map((r) => r[metric]).filter((x) => x != null);
    if (!vals.length || v == null) return null;
    const below = vals.filter((x) => x < v).length, eq = vals.filter((x) => x === v).length;
    return ((below + eq / 2) / vals.length) * 100;
  }
  const medianAt = (date, metric) => medianOf((S.byDate.get(date) || []).map((r) => r[metric]));
  const seriesOf = (member, metric) => S.dates.map((d) => { const r = rowAt(d, member); return r && r[metric] != null ? r[metric] : null; });
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
  const tickFor = (metric) => (v) => (Math.abs(v) >= 10000 ? compactFmt.format(v) : v) + ((METRICS[metric] || {}).suffix || "");
  const mf = (metric) => ({ tick: tickFor(metric), tip: (v) => fmt(metric, v, true) });
  const GRID = { color: "rgba(255,255,255,.06)" };

  function lineChart(canvas, labels, sets, f, opts) {
    opts = opts || {};
    charts.push(new Chart(canvas, {
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
        scales: { x: { grid: { display: false } }, y: { reverse: !!opts.reverse, ticks: { callback: f.tick }, grace: "8%" } },
        plugins: {
          legend: { display: sets.length > 1, position: "top", align: "start" },
          tooltip: { callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + f.tip(ctx.parsed.y) } }
        }
      }
    }));
  }

  function chartCard(title, sub, canvasLabel, opts) {
    const canvas = h("canvas", { role: "img", "aria-label": canvasLabel });
    const card = h("section", { class: "card" + (opts && opts.wide ? " wide" : "") },
      h("h3", {}, title), sub ? h("p", { class: "sub" }, sub) : null,
      h("div", { class: "chart" }, canvas));
    return { card, canvas };
  }

  function oneWeekNotice() {
    return h("p", { class: "msg wide-msg" }, "Only one week of data so far. Charts that show change over time will appear once you add a second week.");
  }

  /* ---------- shared controls ---------- */
  function metricSelect(value, onchange, label) {
    const groups = {};
    S.metrics.forEach((k) => { (groups[METRICS[k].group] = groups[METRICS[k].group] || []).push(k); });
    return h("label", { class: "field" }, label || "Statistic",
      h("select", { onchange: (e) => onchange(e.target.value) },
        Object.entries(groups).map(([g, ks]) => h("optgroup", { label: g }, ks.map((k) => h("option", { value: k, selected: k === value }, METRICS[k].label))))));
  }
  const memberHref = (n) => "#/member?name=" + encodeURIComponent(n);
  const classesAt = (date) => [...new Set((S.byDate.get(date) || []).map((r) => r.class).filter(Boolean))].sort();

  /* ---------- views ---------- */
  function viewRankings(root) {
    const m = S.metric, date = S.date, pd = prevDate(date), L = METRICS[m].label;
    const all = ranking(date, m);
    const prev = pd ? Object.fromEntries(ranking(pd, m).map((r) => [r.member, r])) : {};
    const rowsNow = S.byDate.get(date) || [];
    const classes = classesAt(date);
    if (S.classFilter && !classes.includes(S.classFilter)) S.classFilter = "";

    // summary strip
    const vals = all.map((r) => r.value);
    const med = medianOf(vals);
    let riser = null;
    if (pd) for (const r of all) {
      const p = prev[r.member];
      if (!p || !p.value) continue;
      const pct = (r.value - p.value) / Math.abs(p.value);
      if (!riser || pct > riser.pct) riser = { member: r.member, pct };
    }
    const counts = {};
    rowsNow.forEach((r) => { if (r.class) counts[r.class] = (counts[r.class] || 0) + 1; });
    const topClass = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const fourth = riser && riser.pct > 0
      ? h("div", {}, h("dt", {}, "Biggest riser (" + L + ")"), h("dd", {}, riser.member, h("small", { class: "up" }, "▲ +" + (riser.pct * 100).toFixed(1) + "% since " + dateLabel(pd))))
      : topClass ? h("div", {}, h("dt", {}, "Most common class"), h("dd", {}, topClass[0], h("small", {}, topClass[1] + " of " + rowsNow.length + " members"))) : null;
    const strip = h("dl", {},
      h("div", {}, h("dt", {}, "Members"), h("dd", {}, String(rowsNow.length), all.length !== rowsNow.length ? h("small", {}, all.length + " with a " + L + " value") : null)),
      h("div", {}, h("dt", {}, "Median " + L), h("dd", {}, fmt(m, med))),
      h("div", {}, h("dt", {}, "Highest " + L), h("dd", {}, all[0] ? all[0].member : "—", all[0] ? h("small", {}, fmt(m, all[0].value, true)) : null)),
      fourth);

    // controls
    const classSel = h("label", { class: "field" }, "Class",
      h("select", { onchange: (e) => { S.classFilter = e.target.value; fillRows(); } },
        h("option", { value: "" }, "All classes"), classes.map((c) => h("option", { value: c, selected: c === S.classFilter }, c))));
    const search = h("label", { class: "field" }, "Find a member",
      h("input", { type: "search", placeholder: "Name", value: S.query, oninput: (e) => { S.query = e.target.value; fillRows(); } }));

    const sorted = vals.slice().sort((a, b) => a - b);
    const scale = Math.max(1, Math.min(sorted[sorted.length - 1] || 1, (med || 1) * 2.5));
    const tbody = h("tbody");
    function fillRows() {
      const q = S.query.trim().toLowerCase();
      const list = all.filter((r) => (!S.classFilter || r.cls === S.classFilter) && (!q || r.member.toLowerCase().includes(q)));
      tbody.replaceChildren(...list.map((r) => {
        const p = prev[r.member];
        const diff = p ? r.value - p.value : null;
        const move = p ? p.rank - r.rank : null;
        return h("tr", { class: r.rank <= 3 ? "top3" : "" },
          h("td", { class: "rank" }, String(r.rank)),
          h("td", { class: "name" }, h("a", { href: memberHref(r.member), title: "Open " + r.member + "’s profile" }, r.member), flagMark(date, r.member)),
          h("td", {}, r.cls || "—"),
          h("td", { class: "role" }, r.role),
          h("td", { class: "num valcell" }, fmt(m, r.value, true), h("span", { class: "bar", style: "width:" + Math.max(1, Math.min(100, (r.value / scale) * 100)) + "%" })),
          h("td", { class: "num " + (diff == null ? "flat" : diff > 0 ? "up" : diff < 0 ? "down" : "flat") }, diff == null ? "—" : (diff > 0 ? "▲ +" : diff < 0 ? "▼ " : "= ") + fmt(m, Math.abs(diff), false)),
          h("td", { class: "num " + (move == null ? "flat" : move > 0 ? "up" : move < 0 ? "down" : "flat") }, move == null ? "—" : move > 0 ? "▲ " + move : move < 0 ? "▼ " + Math.abs(move) : "="));
      }));
      if (!tbody.children.length) tbody.append(h("tr", {}, h("td", { colspan: 7, class: "empty" }, "No member matches these filters.")));
    }
    fillRows();

    root.append(
      h("h1", {}, "Rankings"),
      h("p", { class: "lede" }, "Week of " + dateLong(date) + ". Choose a statistic to rank members, or open a name to see their profile."),
      h("div", { class: "strip" }, strip),
      h("div", { class: "controls" }, metricSelect(m, (v) => { S.metric = v; render(); }, "Rank by"), classSel, h("span", { class: "spacer" }), search),
      h("div", { class: "table-wrap" }, h("table", {},
        h("caption", { style: "position:absolute;left:-999px" }, "Members ranked by " + L),
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "#"), h("th", { scope: "col" }, "Member"), h("th", { scope: "col" }, "Class"), h("th", { scope: "col" }, "Role"),
          h("th", { scope: "col", class: "num" }, L),
          h("th", { scope: "col", class: "num" }, pd ? "Change since " + dateLabel(pd) : "Change"),
          h("th", { scope: "col", class: "num" }, "Rank move"))),
        tbody)));
  }

  function viewCharts(root) {
    const m = S.chartMetric, date = S.date, L = METRICS[m].label;
    root.append(
      h("h1", {}, "Charts"),
      h("p", { class: "lede" }, "How the guild is doing and who leads. The statistic you choose applies to every chart."),
      h("div", { class: "controls" }, metricSelect(m, (v) => { S.chartMetric = v; render(); })));
    const grid = h("div", { class: "grid" });
    root.append(grid);
    const ranked = ranking(date, m);

    if (multi()) {
      const c1 = chartCard("Median " + L.toLowerCase() + " over time", "Half of the members are above this line", "Line chart of the guild median " + L + " by week", { wide: true });
      grid.append(c1.card);
      lineChart(c1.canvas, S.dates.map(dateLabel), [{ label: "Guild median", data: S.dates.map((d) => medianAt(d, m)), color: SERIES[0] }], mf(m));
    } else grid.append(oneWeekNotice());

    // top 10
    const top = ranked.slice(0, 10);
    const c2 = chartCard("Top 10 by " + L.toLowerCase(), "Week of " + dateLong(date), "Bar chart of the top 10 members by " + L);
    grid.append(c2.card);
    charts.push(new Chart(c2.canvas, {
      type: "bar",
      data: { labels: top.map((r) => r.member), datasets: [{ data: top.map((r) => r.value), backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
      options: {
        indexAxis: "y",
        scales: { x: { ticks: { callback: tickFor(m) }, grid: GRID }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + fmt(m, ctx.parsed.x, true) } } }
      }
    }));

    // top 5 over time
    if (multi()) {
      const top5 = ranked.slice(0, 5).map((r) => r.member);
      const c3 = chartCard("Top 5 members over time", "Ranked by " + L.toLowerCase() + " in the selected week", "Line chart of the top 5 members by " + L + " by week");
      grid.append(c3.card);
      lineChart(c3.canvas, S.dates.map(dateLabel), top5.map((n) => ({ label: n, data: seriesOf(n, m), color: colorFor(n, top5) })), mf(m));
    }

    // distribution (outliers fold into the last bar so one typo can't flatten the chart)
    const vals = ranked.map((r) => r.value);
    if (vals.length >= 3) {
      const sorted = vals.slice().sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
      const lo = sorted[0], cap = Math.min(sorted[sorted.length - 1], q3 + 3 * (q3 - q1)), clipped = cap < sorted[sorted.length - 1];
      const bins = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(vals.length))));
      const w = (cap - lo) / bins || 1;
      const counts = new Array(bins).fill(0);
      vals.forEach((v) => { counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; });
      const lbl = counts.map((_, i) => compactFmt.format(lo + i * w) + (i === bins - 1 && clipped ? "+" : "–" + compactFmt.format(lo + (i + 1) * w)));
      const c4 = chartCard("How members are spread out", "Number of members per " + L.toLowerCase() + " range", "Histogram of members by " + L + " range");
      grid.append(c4.card);
      charts.push(new Chart(c4.canvas, {
        type: "bar",
        data: { labels: lbl, datasets: [{ data: counts, backgroundColor: SERIES[2], borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 40 }] },
        options: {
          scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 }, beginAtZero: true, grid: GRID } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + ctx.parsed.y + (ctx.parsed.y === 1 ? " member" : " members") } } }
        }
      }));
    }

    // class charts
    const classes = classesAt(date);
    if (classes.length) {
      const counts = {};
      (S.byDate.get(date) || []).forEach((r) => { if (r.class) counts[r.class] = (counts[r.class] || 0) + 1; });
      const order = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const c5 = chartCard("Members per class", "Week of " + dateLong(date), "Bar chart of the number of members in each class");
      grid.append(c5.card);
      charts.push(new Chart(c5.canvas, {
        type: "bar",
        data: { labels: order.map((o) => o[0]), datasets: [{ data: order.map((o) => o[1]), backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
        options: {
          indexAxis: "y",
          scales: { x: { ticks: { precision: 0 }, grid: GRID, beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + ctx.parsed.x + (ctx.parsed.x === 1 ? " member" : " members") } } }
        }
      }));

      const byClass = classes.map((c) => {
        const vs = ranked.filter((r) => r.cls === c).map((r) => r.value);
        return { c, n: vs.length, v: medianOf(vs) };
      }).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
      const c6 = chartCard("Median " + L.toLowerCase() + " by class", "Each class’s middle member", "Bar chart of the median " + L + " for each class");
      grid.append(c6.card);
      charts.push(new Chart(c6.canvas, {
        type: "bar",
        data: { labels: byClass.map((x) => x.c), datasets: [{ data: byClass.map((x) => x.v), backgroundColor: SERIES[2], borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
        options: {
          indexAxis: "y",
          scales: { x: { ticks: { callback: tickFor(m) }, grid: GRID, beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + fmt(m, ctx.parsed.x, true) + " (" + byClass[ctx.dataIndex].n + " members)" } } }
        }
      }));
    }

    // scatter
    const xk = m === "level" ? "power" : "level";
    if (S.metrics.includes(xk)) {
      const pts = (S.byDate.get(date) || []).filter((r) => r[m] != null && r[xk] != null).map((r) => ({ x: r[xk], y: r[m], name: r.member }));
      const c7 = chartCard(L + " against " + METRICS[xk].label.toLowerCase(), "One dot per member; hover a dot to see who it is", "Scatter chart of " + L + " against " + METRICS[xk].label, { wide: true });
      grid.append(c7.card);
      charts.push(new Chart(c7.canvas, {
        type: "scatter",
        data: { datasets: [{ data: pts, backgroundColor: SERIES[0], borderColor: SURFACE, borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7 }] },
        options: {
          scales: {
            x: { title: { display: true, text: METRICS[xk].label }, ticks: { callback: tickFor(xk) }, grid: GRID },
            y: { title: { display: true, text: L }, ticks: { callback: tickFor(m) }, grid: GRID }
          },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + ctx.raw.name + ": " + fmt(m, ctx.raw.y, true) + " at " + METRICS[xk].label + " " + fmt(xk, ctx.raw.x, true) } } }
        }
      }));
    }
  }

  function viewCompare(root) {
    const date = S.date, A = S.a, B = S.b;
    const memberSel = (label, value, set) => h("label", { class: "field" }, label,
      h("select", { onchange: (e) => { set(e.target.value); syncHash(); render(); } },
        S.members.map((n) => h("option", { value: n, selected: n === value }, n))));
    root.append(
      h("h1", {}, "Compare members"),
      h("p", { class: "lede" }, "Put two members side by side for the week of " + dateLong(date) + "."),
      h("div", { class: "controls" }, memberSel("Member A", A, (v) => (S.a = v)), memberSel("Member B", B, (v) => (S.b = v))));
    if (A === B) root.append(h("p", { class: "msg" }, "Both selections are the same member. Choose two different members to see a comparison."));

    const ra = rowAt(date, A), rb = rowAt(date, B);
    if (!ra || !rb) {
      root.append(h("p", { class: "msg err" }, (!ra ? A : B) + " has no data for the week of " + dateLong(date) + ". Pick another week or member."));
      return;
    }
    const who = (n, c) => h("span", { class: "who" }, h("span", { class: "dot", style: "background:" + c }), n);
    const text = (label, a, b) => h("tr", {}, h("td", {}, label), h("td", { class: "num" }, a || "—"), h("td", { class: "num" }, b || "—"), h("td", { class: "num flat" }, a && b ? (a === b ? "Same" : "Different") : "—"));
    const body = [text("Class", ra.class, rb.class), text("Role", ra.role, rb.role)];
    S.metrics.forEach((k) => {
      const rk = rankMap(date, k), va = ra[k], vb = rb[k];
      const cell = (v, n, lead) => h("td", { class: "num", style: lead ? "font-weight:600" : "" }, fmt(k, v, true), rk[n] ? h("span", { class: "role" }, "  #" + rk[n]) : null);
      let diff = h("td", { class: "num flat" }, "—");
      if (va != null && vb != null) {
        const gap = va - vb;
        diff = h("td", { class: "num" }, gap === 0 ? "Equal" : h("span", { class: "who" }, h("span", { class: "dot", style: "background:" + (gap > 0 ? SERIES[0] : SERIES[1]) }), (gap > 0 ? A : B) + " leads by " + fmt(k, Math.abs(gap), true)));
      }
      body.push(h("tr", {}, h("td", {}, METRICS[k].label), cell(va, A, va != null && vb != null && va > vb), cell(vb, B, va != null && vb != null && vb > va), diff));
    });
    root.append(h("div", { class: "table-wrap", style: "margin-bottom:16px" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Statistic"),
        h("th", { scope: "col", class: "num" }, who(A, SERIES[0])), h("th", { scope: "col", class: "num" }, who(B, SERIES[1])), h("th", { scope: "col", class: "num" }, "Difference"))),
      h("tbody", {}, body))));

    const grid = h("div", { class: "grid" });
    root.append(grid);

    const axes = RADAR.filter((k) => S.metrics.includes(k) && ra[k] != null && rb[k] != null);
    if (axes.length >= 3) {
      const c2 = chartCard("Overall profile", "Each axis shows where the member stands in the guild: 100 is the best, 50 the middle", "Radar chart comparing " + A + " and " + B);
      grid.append(c2.card);
      const set = (n, row, c) => ({ label: n, data: axes.map((k) => Math.round(percentile(date, k, row[k]))), borderColor: c, backgroundColor: c + "33", pointBackgroundColor: c, pointBorderColor: SURFACE, borderWidth: 2, pointRadius: 4 });
      charts.push(new Chart(c2.canvas, {
        type: "radar",
        data: { labels: axes.map((k) => METRICS[k].label), datasets: [set(A, ra, SERIES[0]), set(B, rb, SERIES[1])] },
        options: {
          scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: "rgba(255,255,255,.1)" }, angleLines: { color: "rgba(255,255,255,.1)" }, pointLabels: { color: "#b4b4bd", font: { size: 12 } } } },
          plugins: { legend: { position: "top", align: "start" }, tooltip: { callbacks: { label: (ctx) => " " + ctx.dataset.label + ": better than " + ctx.parsed.r + "% of the guild" } } }
        }
      }));
    }

    if (multi()) {
      const m = S.cmpMetric;
      const c1 = chartCard(METRICS[m].label + " over time", null, "Line chart comparing " + A + " and " + B + " on " + METRICS[m].label);
      c1.card.insertBefore(h("div", { class: "controls" }, metricSelect(m, (v) => { S.cmpMetric = v; render(); })), c1.card.children[1] || null);
      grid.append(c1.card);
      lineChart(c1.canvas, S.dates.map(dateLabel), [{ label: A, data: seriesOf(A, m), color: SERIES[0] }, { label: B, data: seriesOf(B, m), color: SERIES[1] }], mf(m));
    } else grid.append(oneWeekNotice());
  }

  function viewMember(root) {
    const date = S.date, name = S.profile, r = rowAt(date, name);
    const pick = h("label", { class: "field" }, "Member",
      h("select", { onchange: (e) => { S.profile = e.target.value; history.replaceState(null, "", memberHref(S.profile)); render(); } },
        S.members.map((n) => h("option", { value: n, selected: n === name }, n))));
    root.append(h("h1", {}, name || "Member"), h("div", { class: "controls" }, pick,
      h("a", { class: "btn", href: "#/compare?a=" + encodeURIComponent(name) }, "Compare with another member")));
    if (!r) { root.append(h("p", { class: "msg err" }, name + " has no data for the week of " + dateLong(date) + ". Pick another week.")); return; }
    const fl = flagsFor(date, name);
    if (fl.length) root.append(h("div", { class: "msg warn" }, h("strong", {}, "⚠ Worth checking"), h("ul", { class: "plain" }, fl.map((t) => h("li", {}, t))),
      h("span", { class: "role" }, "The values below are shown as they are in the CSV file.")));

    const pr = rankMap(date, "power"), n = (S.byDate.get(date) || []).length;
    root.append(h("div", { class: "strip" }, h("dl", {},
      h("div", {}, h("dt", {}, "Role"), h("dd", {}, r.role)),
      h("div", {}, h("dt", {}, "Class"), h("dd", {}, r.class || "—", r.class_level != null ? h("small", {}, "Class level " + fullFmt.format(r.class_level)) : null)),
      r.level != null ? h("div", {}, h("dt", {}, "Level"), h("dd", {}, String(r.level))) : null,
      pr[name] ? h("div", {}, h("dt", {}, "Power"), h("dd", {}, fmt("power", r.power), h("small", {}, "Rank " + pr[name] + " of " + n))) : null)));

    // statistics table
    const rows = S.metrics.map((k) => {
      const v = r[k], rk = rankMap(date, k), med = medianAt(date, k);
      const rel = v != null && med ? ((v - med) / Math.abs(med)) * 100 : null;
      return h("tr", {},
        h("td", {}, METRICS[k].label),
        h("td", { class: "num" }, fmt(k, v, true)),
        h("td", { class: "num" }, rk[name] ? "#" + rk[name] + " of " + Object.keys(rk).length : "—"),
        h("td", { class: "num" }, fmt(k, med, true)),
        h("td", { class: "num " + (rel == null ? "flat" : rel > 0.5 ? "up" : rel < -0.5 ? "down" : "flat") }, rel == null ? "—" : (rel > 0.5 ? "▲ +" : rel < -0.5 ? "▼ " : "= ") + (Math.abs(rel) > 999 ? "999%+" : Math.abs(rel).toFixed(0) + "%")));
    });
    root.append(h("h2", {}, "Statistics"), h("div", { class: "table-wrap", style: "margin-bottom:24px" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Statistic", "Value", "Guild rank", "Guild median", "Versus median"].map((t, i) => h("th", { scope: "col", class: i ? "num" : "" }, t)))),
      h("tbody", {}, rows))));

    // gear
    const gearCards = Object.keys(GEAR).filter((g) => GEAR[g].some((c) => r[c] != null)).map((g) =>
      h("section", { class: "card" }, h("h3", {}, GEAR_TITLES[g]), h("table", { class: "mini" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Piece"), h("th", { scope: "col", class: "num" }, "Value"), h("th", { scope: "col", class: "num" }, "Guild median"))),
        h("tbody", {}, GEAR[g].map((c) => {
          const med = medianOf((S.byDate.get(date) || []).map((x) => x[c]));
          return h("tr", {}, h("td", {}, GEAR_LABELS[c]), h("td", { class: "num " + (r[c] != null && med != null ? (r[c] > med ? "up" : r[c] < med ? "down" : "") : "") }, r[c] == null ? "—" : fullFmt.format(r[c])), h("td", { class: "num role" }, med == null ? "—" : fullFmt.format(med)));
        })))));
    if (gearCards.length) root.append(h("h2", {}, "Gear"), h("div", { class: "grid three" }, gearCards));

    if (multi()) {
      const hm = S.metrics.includes("power") ? "power" : S.metrics[0];
      const c = chartCard(METRICS[hm].label + " over time", name + " compared with the guild median", "Line chart of " + name + "’s " + METRICS[hm].label + " by week against the guild median");
      c.card.style.marginTop = "24px";
      root.append(c.card);
      lineChart(c.canvas, S.dates.map(dateLabel), [{ label: name, data: seriesOf(name, hm), color: SERIES[0] }, { label: "Guild median", data: S.dates.map((d) => medianAt(d, hm)), color: SERIES[3] }], mf(hm));
    }
  }

  function viewGuild(root) {
    root.append(h("h1", {}, "Guild"), h("p", { class: "lede" }, "Where the guild stands in the floor ranking for the week of " + dateLong(S.date) + "."));
    if (S.guildError) { root.append(h("p", { class: "msg err" }, S.guildError)); return; }
    const rows = S.guild.filter((r) => r.date === S.date).sort((a, b) => a.rank - b.rank);
    if (!rows.length) { root.append(h("p", { class: "msg" }, "No guild ranking was recorded for this week. Choose another week, or add rows for " + S.date + " to the guild file.")); return; }
    const self = rows.find((r) => r.relation === "self") || rows[0];
    const floor = self.floor != null ? self.floor : self.ranked_floor;
    const big = (v) => (v == null ? "—" : Math.abs(v) >= 10000 ? compactFmt.format(v) : fullFmt.format(v));
    root.append(h("div", { class: "strip" }, h("dl", {},
      h("div", {}, h("dt", {}, "Guild"), h("dd", {}, self.guild || self.ranked_guild, self.guild_level != null ? h("small", {}, "Level " + self.guild_level) : null)),
      h("div", {}, h("dt", {}, "Floor"), h("dd", {}, String(floor), h("small", {}, "Ranked " + self.rank))),
      h("div", {}, h("dt", {}, "Boss damage this week"), h("dd", {}, self.boss_damage_pct != null ? self.boss_damage_pct.toFixed(1) + "%" : "—")),
      h("div", {}, h("dt", {}, "Guild power"), h("dd", {}, big(self.guild_power))),
      h("div", {}, h("dt", {}, "Members"), h("dd", {}, self.members != null ? String(self.members) : "—")),
      h("div", {}, h("dt", {}, "Activeness"), h("dd", {}, big(self.activeness))))));

    const gap = (r) => {
      if (r === self) return "This is us";
      const d = r.ranked_floor - self.ranked_floor;
      return d === 0 ? "Same floor" : Math.abs(d) + (Math.abs(d) === 1 ? " floor " : " floors ") + (d > 0 ? "ahead" : "behind");
    };
    root.append(h("h2", {}, "Floor ranking"), h("div", { class: "table-wrap", style: "margin-bottom:24px" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Rank"), h("th", { scope: "col" }, "Guild"), h("th", { scope: "col", class: "num" }, "Floor"), h("th", { scope: "col", class: "num" }, "Boss damage"), h("th", { scope: "col", class: "num" }, "Compared with us"))),
      h("tbody", {}, rows.map((r) => h("tr", { class: r === self ? "self" : "" },
        h("td", { class: "rank" }, String(r.rank)), h("td", { class: "name" }, r.ranked_guild), h("td", { class: "num" }, String(r.ranked_floor)),
        h("td", { class: "num" }, r.boss_damage_pct != null ? r.boss_damage_pct.toFixed(1) + "%" : "—"), h("td", { class: "num " + (r === self ? "flat" : r.ranked_floor > self.ranked_floor ? "down" : "up") }, gap(r))))))));

    const selfRows = S.guild.filter((r) => r.relation === "self").sort((a, b) => a.date.localeCompare(b.date));
    if (selfRows.length > 1) {
      const labels = selfRows.map((r) => dateLabel(r.date));
      const defs = [
        { t: "Floor over time", get: (r) => (r.floor != null ? r.floor : r.ranked_floor), f: { tick: (v) => (Number.isInteger(v) ? v : ""), tip: (v) => String(v) } },
        { t: "Floor ranking over time", get: (r) => r.rank, reverse: true, f: { tick: (v) => (Number.isInteger(v) ? "#" + v : ""), tip: (v) => "#" + v } },
        { t: "Guild power over time", get: (r) => r.guild_power, f: { tick: (v) => compactFmt.format(v), tip: (v) => fullFmt.format(v) } },
        { t: "Activeness over time", get: (r) => r.activeness, f: { tick: (v) => compactFmt.format(v), tip: (v) => fullFmt.format(v) } }
      ].filter((d) => selfRows.some((r) => d.get(r) != null));
      const grid = h("div", { class: "grid" });
      root.append(h("h2", {}, "Over time"), grid);
      defs.forEach((d) => { const c = chartCard(d.t, null, d.t); grid.append(c.card); lineChart(c.canvas, labels, [{ label: self.guild || "Guild", data: selfRows.map(d.get), color: SERIES[0] }], d.f, { reverse: d.reverse }); });
    } else root.append(h("h2", {}, "Over time"), oneWeekNotice());
  }

  /* ---------- data checks ---------- */
  const allIssues = () => S.issuesCache || (S.issuesCache = checkData());
  const flagsFor = (date, member) => allIssues().filter((i) => i.date === date && i.where === member).map((i) => i.text);
  function flagMark(date, member) {
    const f = flagsFor(date, member);
    return f.length ? h("span", { class: "flag", title: f.join(" "), role: "img", "aria-label": "Worth checking: " + f.join(" ") }, "⚠") : null;
  }

  function checkData() {
    const out = [], add = (date, where, text) => out.push({ date, where, text });
    const compact = (v) => compactFmt.format(v);
    S.dates.forEach((d, di) => {
      const rows = S.byDate.get(d);
      const ratios = rows.filter((r) => r.power != null && r.hp).map((r) => r.power / r.hp);
      const mr = medianOf(ratios);
      if (mr) rows.forEach((r) => {
        if (r.power == null || !r.hp) return;
        const q = r.power / r.hp;
        if (q > 2 * mr || q < mr / 2) add(d, r.member, "Power (" + fullFmt.format(r.power) + ") does not fit its HP (" + fullFmt.format(r.hp) + "). Power is normally about " + mr.toFixed(1) + " times HP, here it is " + q.toFixed(1) + ".");
      });
      ["atk", "def", "hp", "spd"].forEach((k) => rows.forEach((r) => {
        if (r[k] == null || r.level == null) return;
        const peers = rows.filter((o) => o !== r && o[k] != null && o.level != null && Math.abs(o.level - r.level) <= 5).map((o) => o[k]);
        if (peers.length < 3) return;
        const mp = medianOf(peers);
        if (r[k] > 10 * mp || r[k] < mp / 10) add(d, r.member, METRICS[k].label + " is " + fullFmt.format(r[k]) + ", while members of a similar level are around " + fullFmt.format(mp) + ".");
      }));
      Object.keys(GEAR).forEach((g) => rows.forEach((r) => {
        const vs = GEAR[g].map((c) => r[c]).filter((v) => v != null);
        if (vs.length < 3) return;
        const mg = medianOf(vs);
        GEAR[g].forEach((c) => { const v = r[c]; if (v != null && (v > 2 * mg || v < mg / 2)) add(d, r.member, GEAR_LABELS[c] + " is " + fullFmt.format(v) + ", while the other " + GEAR_TITLES[g].toLowerCase() + " are around " + fullFmt.format(mg) + "."); });
      }));
      rows.forEach((r) => { if (/[^\p{L}\p{N}_.\-' ]/u.test(r.member)) add(d, r.member, "The name has an unusual character. Check it was read correctly."); });
      if (di > 0) rows.forEach((r) => {
        const p = rowAt(S.dates[di - 1], r.member);
        if (!p) return;
        if (r.level != null && p.level != null && r.level < p.level) add(d, r.member, "Level went down from " + p.level + " to " + r.level + ".");
        if (r.power != null && p.power && Math.abs(r.power - p.power) / p.power > 0.5) add(d, r.member, "Power changed by more than 50% in one week (" + compact(p.power) + " to " + compact(r.power) + ").");
      });
    });
    const guildDates = [...new Set(S.guild.map((g) => g.date))];
    guildDates.forEach((d) => {
      const g = S.guild.find((x) => x.date === d && x.relation === "self") || S.guild.find((x) => x.date === d);
      if (g.boss_hp_remaining_pct != null && g.boss_hp_remaining_pct > 100) add(d, "Guild file", "Boss HP remaining is " + g.boss_hp_remaining_pct + "%, which is above 100. A decimal point may be missing (" + (g.boss_hp_remaining_pct / 10).toFixed(1) + "?).");
      const rows = S.byDate.get(d);
      if (!rows) return;
      if (g.members != null && g.members !== rows.length) add(d, "Guild file", "The guild file says " + g.members + " members, the members file has " + rows.length + ".");
      const sum = rows.reduce((a, r) => a + (r.power || 0), 0);
      if (g.guild_power && Math.abs(sum - g.guild_power) / g.guild_power > 0.01) add(d, "Guild file", "Member powers add up to " + compact(sum) + " but the guild file says " + compact(g.guild_power) + ".");
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  function viewData(root) {
    const msg = h("div", { id: "dataMsg" });
    const file = h("input", { type: "file", accept: ".csv,text/csv", hidden: true, onchange: (e) => e.target.files[0] && readFile(e.target.files[0]) });
    const drop = h("div", { class: "drop" },
      h("p", { style: "margin:0 0 10px" }, "Drop a members, stats or guild CSV here to preview it on this device."),
      h("button", { class: "btn primary", type: "button", onclick: () => file.click() }, "Choose a CSV file"), file);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));

    function readFile(f) {
      const rd = new FileReader();
      rd.onload = () => {
        const text = String(rd.result);
        const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
        const isGuild = head.includes("relation") && head.includes("ranked_guild");
        const isMembers = !isGuild && (head.includes("player_id") || head.includes("class") || head.includes("atk"));
        const kind = isGuild ? "guild" : isMembers ? "members" : "stats";
        const res = isGuild ? toGuild(text) : toMembers(text);
        if (res.error) { msg.replaceChildren(h("p", { class: "msg err" }, f.name + ": " + res.error)); return; }
        const src = "Local file: " + f.name;
        if (kind === "guild") setGuild(res.rows, src); else if (kind === "members") loadMembers(res.rows, src); else loadStats(res.rows, src);
        render();
        document.getElementById("dataMsg").replaceChildren(h("p", { class: "msg ok" }, "Loaded " + res.rows.length + " rows from " + f.name + " as the " + kind + " file. This is a preview only; nothing is saved or published."));
      };
      rd.readAsText(f);
    }
    const download = (name, header, example) => {
      const a = h("a", { href: URL.createObjectURL(new Blob([header.join(",") + "\n" + example + "\n"], { type: "text/csv" })), download: name });
      document.body.append(a); a.click(); a.remove();
    };
    const memberExample = "2026-10-12,ExampleName,700000000000,Member,15000000,160,500,10000,Magister,200,900000,800000,4000000,700000,150,150,150,150,150,150,150,150,150,150,150,150,150";
    const guildExample = "2026-10-12,YourGuild,18,59,900000000,870000,115,50.0,self,2,YourGuild,115,50.0";
    const statsExample = "2026-10-12,ExampleName,Member,15000000,160,500,84000";

    const issues = allIssues().concat(S.statsNotes).sort((a, b) => b.date.localeCompare(a.date));
    const checkBlock = issues.length
      ? h("div", { class: "table-wrap", style: "margin-bottom:24px;max-height:380px;overflow:auto" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Week"), h("th", { scope: "col" }, "Where"), h("th", { scope: "col" }, "What looks wrong"))),
        h("tbody", {}, issues.slice(0, 80).map((i) => h("tr", {}, h("td", {}, dateLabel(i.date)), h("td", { class: "name" }, i.where), h("td", { style: "white-space:normal;min-width:260px" }, i.text))))))
      : h("p", { class: "msg ok" }, "No problems spotted.");

    const latest = S.dates[S.dates.length - 1];
    root.append(
      h("h1", {}, "Data"),
      h("p", { class: "lede" }, "The site reads up to three CSV files: member details (one row per member per week), the guild ranking (one block of rows per week), and an optional stats file for event scores."),
      msg,
      h("div", { class: "strip" }, h("dl", {},
        h("div", {}, h("dt", {}, "Members file"), h("dd", { style: "font-size:16px;word-break:break-all" }, S.memberSource)),
        h("div", {}, h("dt", {}, "Member rows"), h("dd", {}, fullFmt.format(S.rows.length), h("small", {}, S.dates.length + (S.dates.length === 1 ? " week: " : " weeks: ") + (S.dates.length > 1 ? dateLabel(S.dates[0]) + " to " + dateLabel(latest) : dateLong(latest))))),
        h("div", {}, h("dt", {}, "Guild file"), h("dd", { style: "font-size:16px;word-break:break-all" }, S.guildSource || (S.guildError ? "Could not be read" : "Not found"))),
        h("div", {}, h("dt", {}, "Guild rows"), h("dd", {}, String(S.guild.length))),
        h("div", {}, h("dt", {}, "Stats file"), h("dd", { style: "font-size:16px;word-break:break-all" }, S.statsSource || (S.statsError ? "Could not be read" : "Not found"),
          S.statsSource ? h("small", {}, S.metrics.includes("event_score") ? "Event scores loaded" : "No event scores in it yet") : null)))),
      S.guildError ? h("p", { class: "msg err" }, S.guildError) : document.createDocumentFragment(),
      S.statsError ? h("p", { class: "msg err" }, S.statsError) : document.createDocumentFragment(),
      h("h2", {}, "Worth checking"),
      h("p", { class: "lede", style: "margin-bottom:12px" }, "Values that look like typing or reading slips. The site still shows them as they are, so correct the CSV and publish again."),
      checkBlock,
      h("div", { class: "grid" },
        h("section", { class: "card" }, h("h2", {}, "Update the site"),
          h("ol", { class: "steps" },
            h("li", {}, "Add the new week’s rows at the end of data/members.csv and data/guild.csv. If you track events, add them to data/stats.csv too."),
            h("li", {}, "Keep the first line (the column names) and write dates as YYYY-MM-DD."),
            h("li", {}, "On GitHub, open the file, choose the pencil, paste the rows, then Commit changes."),
            h("li", {}, "GitHub Pages republishes in about a minute.")),
          h("div", { class: "controls" },
            h("button", { class: "btn", type: "button", onclick: () => download("members-template.csv", MEMBER_HEADER, memberExample) }, "Members template"),
            h("button", { class: "btn", type: "button", onclick: () => download("guild-template.csv", GUILD_HEADER, guildExample) }, "Guild template"),
            h("button", { class: "btn", type: "button", onclick: () => download("stats-template.csv", STATS_HEADER, statsExample) }, "Stats template"))),
        h("section", { class: "card" }, h("h2", {}, "Preview a file"), h("p", { class: "lede", style: "margin-bottom:12px" }, "Check a file before you publish it. Errors tell you which line to fix."), drop)),
      h("h2", { style: "margin-top:28px" }, "Latest member rows"),
      h("div", { class: "table-wrap", style: "max-height:420px;overflow:auto" }, (() => {
        const cols = ["date", "member", "role", "class", "power", "level", "contribution", "atk", "def", "hp", "spd"].filter((c) => c === "date" || c === "member" || c === "role" || c === "class" || S.metrics.includes(c));
        const text = new Set(["date", "member", "role", "class"]);
        const recent = S.rows.slice().sort((a, b) => b.date.localeCompare(a.date) || a.member.localeCompare(b.member)).slice(0, 200);
        return h("table", {},
          h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col", class: text.has(c) ? "" : "num" }, c)))),
          h("tbody", {}, recent.map((r) => h("tr", {}, cols.map((c) => h("td", { class: text.has(c) ? "" : "num" }, text.has(c) ? r[c] : r[c] == null ? "—" : fullFmt.format(r[c])))))));
      })()));
  }

  /* ---------- router ---------- */
  const ROUTES = { rankings: viewRankings, charts: viewCharts, compare: viewCompare, member: viewMember, guild: viewGuild, data: viewData };
  const NAV_FOR = { member: "rankings" };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    return { route: ROUTES[path] ? path : "rankings", params: new URLSearchParams(qs || "") };
  }
  function syncHash() {
    if (parseHash().route === "compare") history.replaceState(null, "", "#/compare?a=" + encodeURIComponent(S.a) + "&b=" + encodeURIComponent(S.b));
  }
  function applyParams() {
    const { route, params } = parseHash();
    if (route === "compare") {
      if (S.members.includes(params.get("a"))) S.a = params.get("a");
      if (S.members.includes(params.get("b"))) S.b = params.get("b");
      if (S.a === S.b) S.b = S.members.find((n) => n !== S.a) || S.b;
    }
    if (route === "member" && S.members.includes(params.get("name"))) S.profile = params.get("name");
  }

  function render() {
    const { route } = parseHash();
    destroyCharts();
    const navRoute = NAV_FOR[route] || route;
    document.querySelectorAll("#nav a").forEach((a) => (a.getAttribute("data-route") === navRoute ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.getElementById("navGuild").hidden = !(S.guild.length || S.guildError);
    const root = document.getElementById("view");
    root.replaceChildren();
    if (!S.rows.length) return;
    ROUTES[route](root);
  }

  function showFatal(text) {
    document.getElementById("view").replaceChildren(
      h("h1", {}, "Can’t load the data"),
      h("p", { class: "msg err" }, text),
      h("p", { class: "lede" }, "If you opened index.html straight from your computer, browsers block reading the CSV files. Publish with GitHub Pages, or run a local server from the project folder (python3 -m http.server)."));
  }

  window.addEventListener("hashchange", () => { applyParams(); render(); window.scrollTo(0, 0); });
  document.getElementById("weekSel").addEventListener("change", (e) => { S.date = e.target.value; render(); });

  /* ---------- boot ---------- */
  document.title = CFG.title;
  document.getElementById("brand").textContent = CFG.title;
  setupChartDefaults();

  const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("Could not fetch " + u + " (" + r.status + ")."); return r.text(); });
  Promise.all([get(CFG.membersUrl), get(CFG.guildUrl).catch(() => null), get(CFG.statsUrl).catch(() => null)])
    .then(([mt, gt, st]) => {
      const res = toMembers(mt);
      if (res.error) throw new Error(CFG.membersUrl + ": " + res.error);
      if (st != null) {
        const sr = toMembers(st);
        if (sr.error) S.statsError = CFG.statsUrl + ": " + sr.error; else { S.statsRaw = sr.rows; S.statsSource = CFG.statsUrl; }
      }
      loadMembers(res.rows, CFG.membersUrl);
      if (gt != null) {
        const gr = toGuild(gt);
        if (gr.error) S.guildError = CFG.guildUrl + ": " + gr.error; else setGuild(gr.rows, CFG.guildUrl);
      }
      applyParams();
      render();
    })
    .catch((e) => showFatal(e.message));
})();
