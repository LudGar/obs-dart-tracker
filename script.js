(() => {
const $ = (sel) => document.querySelector(sel);

const SVG_NS = "http://www.w3.org/2000/svg";

const el = (tag, attrs = {}, children = []) => {
const n = document.createElement(tag);
for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
}
for (const c of children) n.appendChild(c);
return n;
};

const svgEl = (tag, attrs = {}, children = []) => {
const n = document.createElementNS(SVG_NS, tag);
for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.setAttribute("class", v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
}
for (const c of children) n.appendChild(c);
return n;
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// --- URL params (OBS)
const params = new URLSearchParams(location.search);
const minimal = params.get("minimal") === "1";
const transparent = params.get("transparent") === "1";
const scale = parseFloat(params.get("scale") || "1");
if (!Number.isNaN(scale) && scale > 0) document.documentElement.style.setProperty("--scale", String(scale));
if (transparent) document.body.classList.add("transparent");
if (minimal) document.body.classList.add("hide-ui");

// --- DOM
const themeSelect = $("#themeSelect");

const boardMount = $("#boardMount");
const fx180 = $("#fx180");
const gameMode = $("#gameMode");
const x01Start = $("#x01Start");
const doubleIn = $("#doubleIn");
const doubleOut = $("#doubleOut");
const x01Controls = $("#x01Controls");
const x01Toggles = $("#x01Toggles");
const cricketControls = $("#cricketControls");

const btnAddPlayer = $("#btnAddPlayer");
const btnNewLeg = $("#btnNewLeg");
const btnUndoDart = $("#btnUndoDart");
const btnUndoTurn = $("#btnUndoTurn");
const btnHide = $("#btnHide");

const checkoutHint = $("#checkoutHint");

const btnEndTurn = $("#btnEndTurn");
const btnClearTurn = $("#btnClearTurn");

const playersList = $("#playersList");
const scoreboard = $("#scoreboard");

const dartChips = $("#dartChips");
const turnTotalEl = $("#turnTotal");
const turnLabel = $("#turnLabel");
const turnThrows = $("#turnThrows");

// --- Dartboard definition (standard order clockwise starting at top: 20)
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Radii (SVG units) - corrected to avoid overlap
const EPS = 1.2;      // radial gap between rings to prevent overlap
const ANG_PAD = 0.35; // degrees trimmed off each wedge edge to prevent seam overlap

const R = {
  outerDouble: 240,
  innerDouble: 215,

  outerTreble: 140,
  innerTreble: 118,

  outerBull: 32,
  innerBull: 16
};

  // --- Game state
const cricketTargets = ["20","19","18","17","16","15","B"]; // B = bull
const state = {
mode: "x01",
x01Start: 501,
optDoubleIn: false,
optDoubleOut: true,

players: [],
currentPlayer: 0,

// current turn
turnDarts: [], // {label, base, mult, score, isDouble, isTreble, isBull, isOuterBull}
history: []    // for undo: snapshots
};

    
    function applyTheme(theme) {
    const allowed = ["classic","neon","mono","slate","retro"];
    const t = allowed.includes(theme) ? theme : "neon";

    document.body.classList.remove(
        "theme-classic","theme-neon","theme-mono","theme-slate","theme-retro"
    );
    document.body.classList.add(`theme-${t}`);

    // keep URL in sync for OBS
    const u = new URL(location.href);
    u.searchParams.set("theme", t);
    history.replaceState({}, "", u.toString());

    if (themeSelect) themeSelect.value = t;
    }

    function defaultPlayer(name) {
        return {
        name,
        // X01
        score: state.x01Start,
        inOpened: !state.optDoubleIn,
        // Cricket
        cricketMarks: Object.fromEntries(cricketTargets.map(t => [t, 0])),
        cricketScore: 0,
        legs: 0
        };
    }

    function snapshot() {
        return JSON.stringify({
        state: {
            mode: state.mode,
            x01Start: state.x01Start,
            optDoubleIn: state.optDoubleIn,
            optDoubleOut: state.optDoubleOut,
            currentPlayer: state.currentPlayer,
            turnDarts: state.turnDarts,
            players: state.players
        }
        });
    }

    function restore(snap) {
        const obj = JSON.parse(snap);
        const s = obj.state;
        state.mode = s.mode;
        state.x01Start = s.x01Start;
        state.optDoubleIn = s.optDoubleIn;
        state.optDoubleOut = s.optDoubleOut;
        state.currentPlayer = s.currentPlayer;
        state.turnDarts = s.turnDarts;
        state.players = s.players;
        syncControlsFromState();
        renderAll();
    }

    function pushHistory() {
        state.history.push(snapshot());
        if (state.history.length > 200) state.history.shift();
    }

    function ensureTwoPlayers() {
        if (state.players.length === 0) {
        state.players.push(defaultPlayer("Player 1"));
        state.players.push(defaultPlayer("Player 2"));
        } else if (state.players.length === 1) {
        state.players.push(defaultPlayer("Player 2"));
        }
    }

  // --- UI: sync controls
    function syncControlsFromState() {
        gameMode.value = state.mode;
        x01Start.value = String(state.x01Start);
        doubleIn.checked = state.optDoubleIn;
        doubleOut.checked = state.optDoubleOut;

        const isX01 = state.mode === "x01";
        x01Controls.style.display = isX01 ? "" : "none";
        x01Toggles.style.display = isX01 ? "" : "none";
        cricketControls.style.display = isX01 ? "none" : "";
    }

  // --- Dartboard SVG generation
    function polarToXY(cx, cy, r, deg) {
        const rad = (deg - 90) * Math.PI / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    function arcPath(cx, cy, r1, r2, a0, a1) {
        const p1 = polarToXY(cx, cy, r2, a0);
        const p2 = polarToXY(cx, cy, r2, a1);
        const p3 = polarToXY(cx, cy, r1, a1);
        const p4 = polarToXY(cx, cy, r1, a0);
        const large = (a1 - a0) > 180 ? 1 : 0;

        return [
        `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
        `A ${r2} ${r2} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
        `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
        `A ${r1} ${r1} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
        "Z"
        ].join(" ");
    }

    function segPath(cx, cy, r1, r2, a0, a1, base, mult, cls) {
    // apply tiny angle padding so wedges don't overlap on edges
    const aa0 = a0 + ANG_PAD;
    const aa1 = a1 - ANG_PAD;

    return svgEl("path", {
        d: arcPath(cx, cy, r1, r2, aa0, aa1),
        class: `seg ${cls}`,
        "data-base": String(base),
        "data-mult": String(mult),
        "data-label": (mult === 2 ? "D" : mult === 3 ? "T" : "S") + String(base),
        tabindex: "0"
    });
    }

    function makeBoardSVG() {
        const size = 520;
        const cx = size / 2, cy = size / 2;
        const PAD = 40;
        const svg = svgEl("svg", {
        class:          "board-svg",
        viewBox:        `${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}`,
        role:           "img",
        "aria-label":   "Dartboard"
        });

        const g = svgEl("g");
        svg.appendChild(g);

        g.appendChild(svgEl("circle", {
        cx, cy, r: R.outerDouble + 10,
        fill: "rgba(255,255,255,0.03)",
        stroke: "rgba(255,255,255,0.14)",
        "stroke-width": "2"
        }));

        const sectorAngle = 360 / 20;

        for (let i = 0; i < 20; i++) {
        const value = SECTORS[i];
        const centerAngle = i * sectorAngle;
        const a0 = centerAngle - sectorAngle / 2;
        const a1 = centerAngle + sectorAngle / 2;

        const singleClass = (i % 2 === 0) ? "ring-single-a" : "ring-single-b";

            // Double ring (outermost)
            g.appendChild(segPath(cx, cy, R.innerDouble + EPS, R.outerDouble - EPS, a0, a1, value, 2, "ring-double"));

            // Outer single (between double and treble)
            g.appendChild(segPath(cx, cy, R.outerTreble + EPS, R.innerDouble - EPS, a0, a1, value, 1, singleClass));

            // Treble ring
            g.appendChild(segPath(cx, cy, R.innerTreble + EPS, R.outerTreble - EPS, a0, a1, value, 3, "ring-treble"));

            // Inner single (between bull and treble)  ✅ this is the big fix
            g.appendChild(segPath(cx, cy, R.outerBull + EPS, R.innerTreble - EPS, a0, a1, value, 1, singleClass));


        const textPos = polarToXY(cx, cy, R.outerDouble + 35, centerAngle);
        const t = svgEl("text", {
            x: textPos.x,
            y: textPos.y,
            class: "textnum",
            "text-anchor": "middle",
            "dominant-baseline": "middle"
        });
        t.textContent = String(value);
        g.appendChild(t);
        }

        const outerBull = svgEl("circle", {
        class: "seg bull-outer",
        cx, cy, r: R.outerBull,
        "data-base": "25",
        "data-mult": "1",
        "data-label": "OB",
        tabindex: "0"
        });
        const innerBull = svgEl("circle", {
        class: "seg bull-inner",
        cx, cy, r: R.innerBull,
        "data-base": "25",
        "data-mult": "2",
        "data-label": "BULL",
        tabindex: "0"
        });
        g.appendChild(outerBull);
        g.appendChild(innerBull);

        const rings = [
            R.outerDouble, R.innerDouble,
            R.outerTreble, R.innerTreble,
            R.outerBull, R.innerBull
            ];

        for (const rr of rings) {
        g.appendChild(svgEl("circle", { class: "wire", cx, cy, r: rr }));
        }

        for (let i = 0; i < 20; i++) {
        const ang = i * sectorAngle - sectorAngle / 2;
        const pA = polarToXY(cx, cy, R.outerDouble, ang);
        const pB = polarToXY(cx, cy, R.outerBull, ang);
        g.appendChild(svgEl("line", { class: "wire", x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y }));
        }

        svg.addEventListener("click", (e) => {
        const target = e.target.closest(".seg");
        if (!target) return;

        // brief glow pulse (no box, just neon)
        target.classList.add("pulse");
        setTimeout(() => target.classList.remove("pulse"), 130);

        const base = parseInt(target.getAttribute("data-base"), 10);
        const mult = parseInt(target.getAttribute("data-mult"), 10);
        const label = target.getAttribute("data-label") || "";
        addDart(base, mult, label);
        });
        
        return svg;
    }

  // --- Scoring core
    function current() {
        return state.players[state.currentPlayer];
    }

    function dartLabel(base, mult, labelFromSvg) {
        if (labelFromSvg === "BULL") return "BULL";
        if (labelFromSvg === "OB") return "OB";
        const prefix = mult === 3 ? "T" : mult === 2 ? "D" : "S";
        return `${prefix}${base}`;
    }

    function addDart(base, mult, labelFromSvg = "") {
        if (state.turnDarts.length >= 3) return;

        pushHistory();

        const score = base * mult;
        const isDouble = (mult === 2) || (labelFromSvg === "BULL");
        const isTreble = (mult === 3);
        const isBull = (labelFromSvg === "BULL");
        const isOuterBull = (labelFromSvg === "OB");

        const d = {
        base, mult,
        score,
        label: dartLabel(base, mult, labelFromSvg),
        isDouble, isTreble, isBull, isOuterBull
        };

        state.turnDarts.push(d);
        renderTurn();

        if (state.turnDarts.length === 3) {
        const sum = state.turnDarts.reduce((a, x) => a + x.score, 0);
        if (sum === 180) play180();
        }
    }

    function clearTurn() {
        if (state.turnDarts.length === 0) return;
        pushHistory();
        state.turnDarts = [];
        renderTurn();
    }

    function endTurn() {
    if (state.turnDarts.length === 0) return;

    pushHistory();

    let legWon = false;

    if (state.mode === "x01") legWon = applyTurnX01();
    else legWon = applyTurnCricket();

    // Clear current turn darts no matter what
    state.turnDarts = [];

    if (legWon) {
        // HARD STOP: leg ends now, reset everyone for next leg
        newLeg();          // newLeg() already renders
        return;
    }

    // Otherwise continue normally to next player
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    renderAll();
    }

    function applyTurnX01() {
    const p = current();
    let workingScore = p.score;
    let opened = p.inOpened;

    let darts = state.turnDarts.slice();

    // Double-In: only darts from the opening double onward count
    if (state.optDoubleIn && !opened) {
        const idx = darts.findIndex(d => d.isDouble);
        if (idx === -1) return false; // no open, no score
        opened = true;
        darts = darts.slice(idx);
    }

    const turnSum = darts.reduce((a, d) => a + d.score, 0);
    const newScore = workingScore - turnSum;

    const isBust = () => {
        if (newScore < 0) return true;
        if (newScore === 1) return true;
        if (newScore === 0 && state.optDoubleOut) {
        const last = darts[darts.length - 1];
        return !(last && last.isDouble); // must finish on double/bull
        }
        return false;
    };

    if (isBust()) {
        // bust: score reverts, nothing changes
        return false;
    }

    p.inOpened = opened;
    p.score = newScore;

    if (p.score === 0) {
        p.legs += 1;
        playWinPulse();
        return true; // ✅ leg won
    }

    return false;
    }

    function findProCheckoutRoute(score, requireDoubleOut) {
    // Dart options ordered by "pro preference"
    // We bias toward T20/T19/T18 lines, then big singles, then doubles.
    const options = [];

    const add = (label, val, isDouble=false, isBull=false) => {
    options.push({ label, val, isDouble, isBull });
    };

    // Trebles (pro preference)
    [20,19,18,17,16,15].forEach(n => add(`T${n}`, n*3));
    // Big singles
    [20,19,18,17,16,15,14,13,12,11,10].forEach(n => add(`${n}`, n));
    // Bulls
    add("BULL", 50, true, true);
    add("OB", 25, false, true);

    // Doubles (important for finishing)
    [20,16,18,19,17,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1].forEach(n => add(`D${n}`, n*2, true, false));

    // If double-out required, last dart must be double or bull(50)
    const isValidLast = (d) => {
    if (!requireDoubleOut) return true;
    return d.isDouble || d.label === "BULL";
    };

    // Search 1 dart finish
    for (const a of options) {
    if (a.val === score && isValidLast(a)) return `<b>${a.label}</b>`;
    }

    // Search 2 dart finish
    for (const a of options) {
    const rem = score - a.val;
    if (rem <= 0) continue;

    for (const b of options) {
    if (b.val === rem && isValidLast(b)) {
        return `${a.label} <b>${b.label}</b>`;
    }
    }
    }

    // Search 3 dart finish
    for (const a of options) {
    const rem1 = score - a.val;
    if (rem1 <= 0) continue;

    for (const b of options) {
    const rem2 = rem1 - b.val;
    if (rem2 <= 0) continue;

    for (const c of options) {
        if (c.val === rem2 && isValidLast(c)) {
        return `${a.label} ${b.label} <b>${c.label}</b>`;
        }
    }
    }
    }

    return null;
    }

    function getCheckoutHintX01(p) {
    // Double-in guidance
    if (state.optDoubleIn && !p.inOpened) {
        return `Need to <b>open with a double</b> (any D, or Bull).`;
    }

    const s = p.score;

    if (s === 0) return `Leg finished.`;
    if (s < 2) return `No finish (bust risk).`;

    // If double-out is required, some numbers are impossible in 3 darts
    const noFinish = new Set([169,168,166,165,163,162,159]);

    if (state.optDoubleOut) {
        if (s > 170) return `No finish. Pro setup: aim to leave <b>40</b> (D20) or <b>32</b> (D16).`;
        if (noFinish.has(s)) return `No 3-dart finish. Pro setup: leave <b>40</b> or <b>32</b>.`;
    }

    // Try to compute a "pro route" finish up to 3 darts
    const route = findProCheckoutRoute(s, state.optDoubleOut);

    if (route) return `Finish: ${route}`;

    // fallback setup hints
    if (state.optDoubleOut) {
        return `Setup: leave <b>40</b> (D20) or <b>32</b> (D16).`;
    }
    return `Finish: score <b>${s}</b> (any).`;
    }

    function cricketKeyForDart(d) {
        if (d.isBull || d.isOuterBull) return "B";
        const b = String(d.base);
        if (cricketTargets.includes(b)) return b;
        return null;
    }

    function applyTurnCricket() {
    const p = current();
    const opponents = state.players.filter((_, i) => i !== state.currentPlayer);

    for (const d of state.turnDarts) {
        const key = cricketKeyForDart(d);
        if (!key) continue;

        // marks: single=1, double=2, treble=3
        let marksToAdd = d.mult;
        if (d.isOuterBull) marksToAdd = 1;
        if (d.isBull) marksToAdd = 2;

        while (marksToAdd > 0) {
        const m = p.cricketMarks[key] || 0;

        if (m < 3) {
            p.cricketMarks[key] = m + 1;
        } else {
            // already closed: score points if any opponent still open on this number
            const anyOpenOpponent = opponents.some(o => (o.cricketMarks[key] || 0) < 3);
            if (anyOpenOpponent) {
            const points = (key === "B") ? 25 : parseInt(key, 10);
            p.cricketScore += points;
            }
        }

        marksToAdd--;
        }
    }

    // Win: closed all + score >= everyone
    const closedAll = cricketTargets.every(k => (p.cricketMarks[k] || 0) >= 3);
    if (closedAll) {
        const maxOpp = Math.max(...opponents.map(o => o.cricketScore));
        if (p.cricketScore >= maxOpp) {
        p.legs += 1;
        playWinPulse();
        return true; // ✅ leg won
        }
    }

    return false;
    }

    function newLeg() {
        pushHistory();
        state.turnDarts = [];

        if (state.mode === "x01") {
        for (const p of state.players) {
            p.score = state.x01Start;
            p.inOpened = !state.optDoubleIn;
        }
        } else {
        for (const p of state.players) {
            p.cricketScore = 0;
            p.cricketMarks = Object.fromEntries(cricketTargets.map(t => [t, 0]));
        }
        }

        state.currentPlayer = 0;
        renderAll();
    }

    function undoDart() {
        if (state.history.length === 0) return;
        const snap = state.history.pop();
        restore(snap);
    }

    function undoTurn() {
        if (state.history.length === 0) return;
        const before = snapshot();
        let guard = 0;
        while (state.history.length > 0 && guard++ < 20) {
        const snap = state.history.pop();
        restore(snap);
        if (state.turnDarts.length === 0) return;
        }
        restore(before);
    }

    function play180() {
        fx180.classList.remove("hidden");
        clearTimeout(play180._t);
        play180._t = setTimeout(() => fx180.classList.add("hidden"), 900);
    }

    function playWinPulse() {
        fx180.querySelector(".fx-title").textContent = "LEG";
        fx180.querySelector(".fx-sub").textContent = "WON";
        fx180.classList.remove("hidden");
        clearTimeout(playWinPulse._t);
        playWinPulse._t = setTimeout(() => {
        fx180.classList.add("hidden");
        fx180.querySelector(".fx-title").textContent = "180";
        fx180.querySelector(".fx-sub").textContent = "MAXIMUM";
        }, 800);
    }

    function renderPlayersUI() {
        playersList.innerHTML = "";
        state.players.forEach((p, idx) => {
        const row = el("div", { class: `player ${idx === state.currentPlayer ? "active" : ""}` });

        const name = el("input", { value: p.name });
        name.addEventListener("input", () => {
            p.name = name.value;
            renderScoreboard();
        });

        const meta = el("div", { class: "meta" });
        const badgeTurn = el("div", { class: `badge ${idx === state.currentPlayer ? "active" : ""}`, text: idx === state.currentPlayer ? "TURN" : `P${idx+1}` });
        const badgeLegs = el("div", { class: "badge", text: `Legs ${p.legs}` });

        const btnDel = el("button", { class: "btn small", title: "Remove player", text: "✕" });
        btnDel.addEventListener("click", () => {
            if (state.players.length <= 2) return;
            pushHistory();
            state.players.splice(idx, 1);
            state.currentPlayer = clamp(state.currentPlayer, 0, state.players.length - 1);
            renderAll();
        });

        meta.appendChild(badgeTurn);
        meta.appendChild(badgeLegs);
        meta.appendChild(btnDel);

        row.appendChild(name);
        row.appendChild(meta);
        playersList.appendChild(row);
        });
    }

    function renderScoreboard() {
        scoreboard.innerHTML = "";

        if (state.mode === "x01") {
        state.players.forEach((p, idx) => {
            const row = el("div", { class: "score-row" });
            const left = el("div", {});
            left.appendChild(el("div", { class: "name", text: p.name }));
            left.appendChild(el("div", { class: "sub", text: state.optDoubleIn ? (p.inOpened ? "In: Open" : "In: Closed") : "In: Open" }));

            const right = el("div", {});
            right.appendChild(el("div", { class: "score", text: String(p.score) }));

            row.style.borderColor = idx === state.currentPlayer ? "rgba(103,232,249,0.35)" : "";
            row.appendChild(left);
            row.appendChild(right);
            scoreboard.appendChild(row);
        });
        } else {
        state.players.forEach((p, idx) => {
            const row = el("div", { class: "score-row" });

            const closedCount = cricketTargets.reduce((a, k) => a + ((p.cricketMarks[k] || 0) >= 3 ? 1 : 0), 0);
            const left = el("div", {});
            left.appendChild(el("div", { class: "name", text: p.name }));
            left.appendChild(el("div", { class: "sub", text: `Closed ${closedCount}/7` }));

            const right = el("div", {});
            right.appendChild(el("div", { class: "score", text: String(p.cricketScore) }));

            row.style.borderColor = idx === state.currentPlayer ? "rgba(103,232,249,0.35)" : "";
            row.appendChild(left);
            row.appendChild(right);
            scoreboard.appendChild(row);

            const marksLine = el("div", { class: "muted smalltext" });
            const parts = cricketTargets.map(k => {
            const m = p.cricketMarks[k] || 0;
            const sym = m >= 3 ? "✦" : m === 2 ? "✕✕" : m === 1 ? "✕" : "·";
            return `${k}:${sym}`;
            }).join("  ");
            marksLine.textContent = parts;
            marksLine.style.margin = "6px 10px 0";
            scoreboard.appendChild(marksLine);
        });
        }
    }

    function renderTurn() {
    const p = current();

    // Header label
    turnLabel.textContent = `${p.name}'s turn`;

    // Dart chips
    dartChips.innerHTML = "";
    state.turnDarts.forEach((d, i) => {
        const chip = el("div", { class: "chip" });
        chip.innerHTML = `${i + 1}. <b>${d.label}</b> <span class="muted">(${d.score})</span>`;
        dartChips.appendChild(chip);
    });

    // Turn total + throw list
    const sum = state.turnDarts.reduce((a, x) => a + x.score, 0);
    turnTotalEl.textContent = String(sum);
    turnThrows.textContent = state.turnDarts.length ? state.turnDarts.map(d => d.label).join(", ") : "—";

    // Checkout helper
    if (typeof checkoutHint !== "undefined" && checkoutHint) {
        checkoutHint.style.display = "";
        if (state.mode === "x01") {
        checkoutHint.innerHTML = getCheckoutHintX01(p);
        } else {
        checkoutHint.innerHTML = `Cricket: close remaining targets, score on open opponents.`;
        }
    }
    }

    function renderBoard() {
        boardMount.innerHTML = "";
        boardMount.appendChild(makeBoardSVG());
    }

    function renderAll() {
        syncControlsFromState();
        renderPlayersUI();
        renderScoreboard();
        renderTurn();
    }

  // --- Events
    gameMode.addEventListener("change", () => {
        pushHistory();
        state.mode = gameMode.value;
        newLeg();
    });

    x01Start.addEventListener("change", () => {
        pushHistory();
        state.x01Start = parseInt(x01Start.value, 10);
        for (const p of state.players) p.score = state.x01Start;
        renderAll();
    });

    doubleIn.addEventListener("change", () => {
        pushHistory();
        state.optDoubleIn = doubleIn.checked;
        for (const p of state.players) p.inOpened = !state.optDoubleIn;
        renderAll();
    });

    doubleOut.addEventListener("change", () => {
        pushHistory();
        state.optDoubleOut = doubleOut.checked;
        renderAll();
    });

    btnAddPlayer.addEventListener("click", () => {
        pushHistory();
        const n = state.players.length + 1;
        const p = defaultPlayer(`Player ${n}`);
        if (state.mode === "x01") {
        p.score = state.x01Start;
        p.inOpened = !state.optDoubleIn;
        }
        state.players.push(p);
        renderAll();
    });

  btnNewLeg.addEventListener("click", newLeg);
  btnUndoDart.addEventListener("click", undoDart);
  btnUndoTurn.addEventListener("click", undoTurn);

  btnEndTurn.addEventListener("click", endTurn);
  btnClearTurn.addEventListener("click", clearTurn);

  btnHide.addEventListener("click", () => toggleUI());

    function toggleUI() {
        document.body.classList.toggle("hide-ui");
    }

    window.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "h") toggleUI();
        if (e.key === "Enter") {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "select" && tag !== "textarea") endTurn();
        }
        if (e.key === "Backspace") {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea") undoDart();
        }
    });

    const themeParam = params.get("theme") || "neon";
    applyTheme(themeParam);

    if (themeSelect) {
    themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
    }

  // --- Init
  state.mode = "x01";
  state.x01Start = 501;
  state.optDoubleIn = false;
  state.optDoubleOut = true;

  ensureTwoPlayers();
  renderBoard();
  renderAll();
})();
