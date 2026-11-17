(() => {
  const root = document.querySelector("[data-hero-map]");
  if (!root) return;

  // site.css sizes the map from --hero-top
  const fitToScreen = () =>
    root.style.setProperty(
      "--hero-top",
      `${root.getBoundingClientRect().top + window.scrollY}px`,
    );
  fitToScreen();
  window.addEventListener("resize", fitToScreen);
  document.fonts?.ready.then(fitToScreen);

  if (!window.d3) return;

  const SRC = root.dataset.src;
  const SPEED = 300; // sim seconds per second
  const DAY_START = 5 * 3600;
  const DAY_END = 25.5 * 3600;
  const TAIL_S = 50; // trail length, sim seconds

  const STEPS = [
    { type: "hold", ms: 15000 },
    { type: "fade", layer: "rail_density", ms: 1000 },
    { type: "hold", ms: 1000 },
    { type: "fade", layer: "network", ms: 1000 },
    { type: "hold", ms: 1500 },
    { type: "fade", layer: "ndvi", ms: 2000 },
    { type: "hold", ms: 2500 },
    { type: "fade", layer: "heat", ms: 2000 },
    { type: "hold", ms: 2500 },
    { type: "fade", layer: "routes", ms: 2000 },
  ];

  const COLOURS = {
    routes: "#1e3765",
    streetcar: "#da251d",
    lines: {
      1: "#f2b705",
      2: "#00923f",
      4: "#a21a68",
      5: "#f07d1a",
      6: "#8b8d8e",
    },
  };

  const stage = root.querySelector(".hero-stage");
  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const tip = root.querySelector(".hero-tip");
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let W, H, frame, segments, trips;
  let simTime = 7.5 * 3600;
  let visible = true;
  let lastPositions = [];
  let vehicleAlpha = 1;
  const images = {};
  const state = {
    step: 0,
    start: 0,
    clock: 0,
    layer: "routes",
    previous: null,
    view: null,
    zoom: null,
  };

  Promise.all([
    d3.json(SRC + "frame.json"),
    d3.json(SRC + "frequency.json"),
    d3.json(SRC + "vehicles.json"),
  ])
    .then(([f, freq, v]) => {
      frame = f;
      W = f.width;
      H = f.height;
      segments = freq;
      trips = prepareVehicles(v);
      state.view = fullView();
      ["rail_density", "network", "ndvi", "heat"].forEach((n) =>
        image(n, `${SRC}${n}.webp`),
      );
      root.querySelector(".hero-loading")?.remove();
      resize();
      new ResizeObserver(resize).observe(stage);
      new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(
        stage,
      );
      d3.timer(tick);
    })
    .catch((err) => {
      root.querySelector(".hero-loading").textContent =
        "The map could not be loaded.";
      console.error(err);
    });

  function image(key, src) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    images[key] = img;
  }

  const ready = (key) => images[key]?.complete && images[key].naturalWidth > 0;

  // ---- vehicles

  function cumulative(deltas) {
    const out = new Float64Array(deltas.length);
    let sum = 0;
    deltas.forEach((v, i) => (out[i] = sum += v));
    return out;
  }

  function prepareVehicles(v) {
    const routes = v.routes.map((r) => {
      const rail = r.type === 1 || r.id === "5" || r.id === "6";
      return { rail, colour: rail ? COLOURS.lines[r.id] : COLOURS.streetcar };
    });
    const shapes = v.shapes.map((s) => {
      const n = s.xy.length / 2;
      const x = new Float64Array(n),
        y = new Float64Array(n);
      let sx = 0,
        sy = 0;
      for (let i = 0; i < n; i++) {
        x[i] = (sx += s.xy[2 * i]) / 10;
        y[i] = (sy += s.xy[2 * i + 1]) / 10;
      }
      return { x, y, d: cumulative(s.d), inside: Uint8Array.from(s.in) };
    });
    const patterns = v.patterns.map((p) => {
      const t = cumulative(p.t);
      return {
        shape: shapes[p.s],
        route: routes[p.r],
        headsign: p.h,
        t,
        d: cumulative(p.d),
        duration: t[t.length - 1],
      };
    });
    return v.trips.map(([p, start]) => ({ pattern: patterns[p], start }));
  }

  function bracket(xs, value) {
    const i = Math.min(Math.max(d3.bisectRight(xs, value), 1), xs.length - 1);
    const span = xs[i] - xs[i - 1];
    return [i, span > 0 ? (value - xs[i - 1]) / span : 0];
  }

  // null once outside the city
  function positionAt(pattern, tau) {
    if (tau < 0 || tau > pattern.duration) return null;
    const [i, f] = bracket(pattern.t, tau);
    const dist = pattern.d[i - 1] + (pattern.d[i] - pattern.d[i - 1]) * f;
    const s = pattern.shape;
    const [j, g] = bracket(s.d, dist);
    if (!s.inside[j - 1] || !s.inside[j]) return null;
    return [
      s.x[j - 1] + (s.x[j] - s.x[j - 1]) * g,
      s.y[j - 1] + (s.y[j] - s.y[j - 1]) * g,
    ];
  }

  // ---- sequence

  const fullView = () => [W / 2, H / 2, W];
  const layerReady = (name) => name === "routes" || ready(name);

  function startStep(i) {
    const step = STEPS[i];
    Object.assign(state, { step: i, start: state.clock });
    if (step.type === "zoom") {
      state.zoom = d3.interpolateZoom(state.view, fullView());
      state.zoomMs = Math.max(step.ms, state.zoom.duration * 0.9);
    }
    if (step.type === "fade") {
      state.previous = state.layer;
      state.layer = step.layer;
    }
  }

  function advance() {
    const step = STEPS[state.step];
    const t = state.clock - state.start;
    if (step.type === "zoom") {
      const p = Math.min(1, t / state.zoomMs);
      state.view = state.zoom(d3.easeCubicInOut(p));
      if (p < 1) return;
    } else if (t < step.ms) {
      return;
    }
    const next = (state.step + 1) % STEPS.length;
    const upcoming = STEPS[next];
    if (upcoming.layer && !layerReady(upcoming.layer)) return;
    startStep(next);
  }

  // ---- drawing

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    draw();
  }

  function draw() {
    if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    const k = canvas.width / state.view[2];
    const tx = canvas.width / 2 - state.view[0] * k;
    const ty = canvas.height / 2 - state.view[1] * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, tx, ty);

    const step = STEPS[state.step];
    const t = state.clock - state.start;
    if (step.type === "fade" && t < step.ms) {
      const p = d3.easeSinInOut(t / step.ms);
      drawLayer(state.previous, k, 1 - p);
      drawLayer(state.layer, k, p);
    } else {
      drawLayer(state.layer, k);
    }

    const target = state.step === 0 && state.layer === "routes" ? 1 : 0;
    vehicleAlpha += (target - vehicleAlpha) * 0.06;
    if (vehicleAlpha > 0.02) drawVehicles(k, tx, ty, dpr, vehicleAlpha);
    else lastPositions = [];
  }

  function drawLayer(name, k, alpha = 1) {
    if (alpha <= 0) return;
    if (name === "routes") return drawRoutes(k, alpha);
    const img = images[name];
    if (!img || !img.complete) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function drawRoutes(k, alpha) {
    const dpr = window.devicePixelRatio || 1;
    // widen by sqrt of zoom
    const cssScale = (canvas.width / dpr / W) * Math.sqrt(W / state.view[2]);
    ctx.strokeStyle = COLOURS.routes;
    ctx.lineCap = "round";
    ctx.globalAlpha = alpha;
    let current = -1;
    for (let i = 0; i < segments.length; i += 5) {
      const w =
        (Math.max(0.35, (0.12 + 0.0085 * segments[i + 4]) * 1.39 * cssScale) *
          dpr) /
        k;
      if (Math.abs(w - current) > 1e-3) {
        if (current > 0) ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = w;
        current = w;
      }
      ctx.moveTo(segments[i] / 10, segments[i + 1] / 10);
      ctx.lineTo(segments[i + 2] / 10, segments[i + 3] / 10);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawVehicles(k, tx, ty, dpr, alpha) {
    const size = (Math.max(0.75, canvas.width / dpr / 1000) * dpr) / k;
    ctx.lineCap = "round";
    lastPositions = [];
    for (const trip of trips) {
      const tau = simTime - trip.start;
      if (tau < 0 || tau > trip.pattern.duration) continue;
      const here = positionAt(trip.pattern, tau);
      if (!here) continue;
      const route = trip.pattern.route;
      const rad = (route.rail ? 3.6 : 2.6) * size;
      const back = positionAt(trip.pattern, Math.max(0, tau - TAIL_S));
      if (back) {
        ctx.globalAlpha = 0.35 * alpha;
        ctx.strokeStyle = route.colour;
        ctx.lineWidth = rad * 1.4;
        ctx.beginPath();
        ctx.moveTo(back[0], back[1]);
        ctx.lineTo(here[0], here[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(here[0], here[1], rad, 0, 2 * Math.PI);
      ctx.fillStyle = route.colour;
      ctx.fill();
      ctx.lineWidth = dpr / k;
      ctx.strokeStyle = "#fbfbf9";
      ctx.stroke();
      lastPositions.push({ x: here[0] * k + tx, y: here[1] * k + ty, trip });
    }
    ctx.globalAlpha = 1;
  }

  // ---- loop

  let last = 0;
  function tick(elapsed) {
    const dt = Math.min(elapsed - last, 100);
    last = elapsed;
    if (!visible) return;
    if (!reduceMotion) {
      state.clock += dt;
      simTime += (dt / 1000) * SPEED;
      if (simTime > DAY_END) simTime = DAY_START;
      advance();
    }
    draw();
  }

  // ---- hover

  stage.addEventListener("pointermove", (event) => {
    if (!lastPositions.length) return (tip.hidden = true);
    const box = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (event.clientX - box.left) * dpr;
    const my = (event.clientY - box.top) * dpr;
    let best = null,
      bestD = 12 * dpr;
    for (const p of lastPositions) {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    tip.hidden = !best;
    if (!best) return;
    tip.textContent = best.trip.pattern.headsign;
    tip.style.left = `${best.x / dpr}px`;
    tip.style.top = `${best.y / dpr}px`;
  });
  stage.addEventListener("pointerleave", () => (tip.hidden = true));
})();
