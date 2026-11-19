/*
 * deck.js — the controls for the 3D engine (fx.js).
 *
 *   dock        scene / energy / shatter / tour / sound / map / command buttons
 *   rail        one dot per section, on the right
 *   palette     Ctrl+K or "/": every section, project, technology and action, searchable
 *   inspector   a project's details plus the projects it is connected to
 *   system map  the machine on its own: drag to turn, scroll to zoom, click a project node
 *
 * Everything it shows about a project is read from the page's own project list, and
 * "connected" means exactly what the machine draws: two projects that share a technology.
 */

const root = document.documentElement;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const icon = (body) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ICONS = {
  command: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  map: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6.8l8-.6M7 8.8l4 7.4M17 7.8l-4 8.4"/>',
  scene: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  energy: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  shatter: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19"/>',
  tour: '<path d="M7 4l13 8-13 8z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function startDeck(S, { sharedTokens }) {
  const stops = S.stops;
  const projects = S.projects;
  const paused = () => root.classList.contains('paused');

  /* ---------------------------------------------------------------- toast */

  const toastEl = h('<div class="fx-toast" role="status" aria-live="polite"></div>');
  document.body.append(toastEl);
  let toastTimer = 0;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
  };

  /* ---------------------------------------------------------------- relations */

  const related = (p) => projects
    .filter((q) => q !== p)
    .map((q) => {
      const shared = sharedTokens(p, q);
      const areas = q.filters.filter((f) => p.filters.includes(f) && f !== 'ml' && f !== 'sde');
      return { q, shared, areas, score: shared.length * 3 + areas.length };
    })
    .filter((r) => r.shared.length)
    .sort((a, b) => b.score - a.score);

  let linkCount = 0;
  for (let i = 0; i < projects.length; i++) for (let j = i + 1; j < projects.length; j++) if (sharedTokens(projects[i], projects[j]).length) linkCount++;

  /* ---------------------------------------------------------------- actions */

  const email = document.querySelector('[data-copy]')?.dataset.copy || '';
  const linkTo = (re) => Array.from(document.querySelectorAll('a[href]')).find((a) => re.test(a.href))?.href || '';
  const github = linkTo(/github\.com\/[^/]+\/?$/);
  const linkedin = linkTo(/linkedin\.com/);

  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); } catch { toast('Could not copy — ' + text); }
  };

  // The page's own smooth-scroll library cancels native smooth scrolling, so jumps are
  // tweened here with instant steps, which it follows happily.
  let glide = 0;
  const cancelGlide = () => { cancelAnimationFrame(glide); glide = 0; };
  const scrollToY = (top) => {
    cancelGlide();
    const max = document.documentElement.scrollHeight - innerHeight;
    const to = Math.max(0, Math.min(max, top)), from = window.scrollY;
    if (paused() || Math.abs(to - from) < 2) return window.scrollTo({ top: to, behavior: 'instant' });
    const dur = Math.min(1500, 500 + Math.abs(to - from) * 0.25), t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      window.scrollTo({ top: from + (to - from) * e, behavior: 'instant' });
      glide = k < 1 ? requestAnimationFrame(tick) : 0;
    };
    glide = requestAnimationFrame(tick);
  };
  window.addEventListener('wheel', cancelGlide, { passive: true });
  window.addEventListener('touchstart', cancelGlide, { passive: true });

  const go = (i) => {
    setExplore(false);
    stopTour();
    scrollToY(S.stopTop(i) - (i ? 12 : 0));
  };
  const step = (d) => go(Math.max(0, Math.min(stops.length - 1, S.index + d)));

  const sceneName = (i) => (i < 0 ? 'follows the page' : `${cap(stops[i].shape)} (pinned)`);
  const setScene = (i) => { S.override = i; toast('Scene: ' + sceneName(i)); syncDock(); };
  const nextScene = () => setScene(((S.override + 2) % (stops.length + 1)) - 1);

  const ENERGY = [['Normal', 1], ['Wild', 2.4], ['Calm', 0.4]];
  const setEnergy = (v) => { S.energy = v; toast('Energy: ' + ENERGY.find((e) => e[1] === v)[0]); syncDock(); };
  const nextEnergy = () => setEnergy(ENERGY[(ENERGY.findIndex((e) => e[1] === S.energy) + 1) % ENERGY.length][1]);

  const shatter = () => { if (paused()) return toast('Motion is paused'); S.shatter(); toast('Shattered — reassembling'); };

  /* tour: the page scrolls itself until you touch anything */
  let touring = false, tourAcc = 0;
  const stopTour = () => { if (touring) { touring = false; syncDock(); } };
  const toggleTour = () => {
    if (touring) { stopTour(); return toast('Tour stopped'); }
    if (paused()) return toast('Motion is paused');
    setExplore(false);
    if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 4) window.scrollTo({ top: 0, behavior: 'instant' });
    touring = true; tourAcc = 0; syncDock();
    toast('Tour running — scroll or press any key to stop');
  };
  const interrupt = (e) => { if (touring && !(e.target instanceof Element && e.target.closest('.fx-dock, .fx-pal'))) stopTour(); };
  window.addEventListener('wheel', interrupt, { passive: true });
  window.addEventListener('touchstart', interrupt, { passive: true });
  window.addEventListener('pointerdown', interrupt, { passive: true });

  /* sound: a quiet pad that opens up as you scroll, and a note for each section */
  let audio = null, soundOn = false;
  const NOTES = [220, 247.5, 293.33, 330, 371.25, 440, 495, 586.67];
  const toggleSound = () => {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return toast('This browser has no audio support');
      const ctx = new Ctx();
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 260; filter.Q.value = 5;
      filter.connect(master);
      for (const f of [55, 82.4, 110.4]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.33;
        o.connect(g); g.connect(filter); o.start();
      }
      audio = { ctx, master, filter };
    }
    soundOn = !soundOn;
    audio.ctx.resume();
    audio.master.gain.setTargetAtTime(soundOn ? 0.05 : 0, audio.ctx.currentTime, 0.4);
    if (soundOn) chime(S.index);
    toast(soundOn ? 'Sound on' : 'Sound off');
    syncDock();
  };
  const chime = (i) => {
    if (!audio || !soundOn) return;
    const { ctx } = audio, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTES[i % NOTES.length];
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1.7);
  };

  /* ---------------------------------------------------------------- dock */

  const dock = h(`
    <div class="fx-dock" role="toolbar" aria-label="Scene controls">
      <button type="button" class="fx-status" data-act="command" aria-label="Open the command palette"><span class="fx-status-n"></span><span class="fx-status-t"></span></button>
      <span class="fx-dock-sep" aria-hidden="true"></span>
      <button type="button" data-act="command" data-tip="Command  Ctrl K">${icon(ICONS.command)}<span class="fx-sr">Command palette</span></button>
      <button type="button" data-act="map" data-tip="System map  M" aria-pressed="false">${icon(ICONS.map)}<span class="fx-sr">System map</span></button>
      <button type="button" data-act="scene" data-tip="Scene  S">${icon(ICONS.scene)}<span class="fx-sr">Next scene</span></button>
      <button type="button" data-act="energy" data-tip="Energy  W">${icon(ICONS.energy)}<span class="fx-sr">Energy</span></button>
      <button type="button" data-act="shatter" data-tip="Shatter  X">${icon(ICONS.shatter)}<span class="fx-sr">Shatter the swarm</span></button>
      <button type="button" data-act="tour" data-tip="Tour  T" aria-pressed="false">${icon(ICONS.tour)}<span class="fx-sr">Auto tour</span></button>
      <button type="button" data-act="sound" data-tip="Sound" aria-pressed="false">${icon(ICONS.sound)}<span class="fx-sr">Sound</span></button>
    </div>`);
  document.body.append(dock);
  const statusN = dock.querySelector('.fx-status-n'), statusT = dock.querySelector('.fx-status-t');
  const dockBtn = (act) => dock.querySelector(`button[data-act="${act}"]:not(.fx-status)`);

  function syncDock() {
    const s = stops[S.index];
    statusN.textContent = String(S.index + 1).padStart(2, '0') + ' / ' + String(stops.length).padStart(2, '0');
    statusT.textContent = `${s.label} · ${S.override >= 0 ? stops[S.override].shape + ' pinned' : s.shape}`;
    dockBtn('map').setAttribute('aria-pressed', String(S.explore));
    dockBtn('tour').setAttribute('aria-pressed', String(touring));
    dockBtn('sound').setAttribute('aria-pressed', String(soundOn));
    dockBtn('scene').classList.toggle('on', S.override >= 0);
    dockBtn('energy').classList.toggle('on', S.energy !== 1);
  }

  const ACTS = {
    command: () => openPalette(''), map: () => setExplore(!S.explore), scene: nextScene, energy: nextEnergy,
    shatter, tour: toggleTour, sound: toggleSound,
  };
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) ACTS[b.dataset.act]();
  });

  /* ---------------------------------------------------------------- rail */

  const rail = h(`<nav class="fx-rail" aria-label="Sections"><ol>${stops.map((s, i) =>
    `<li><button type="button" data-go="${i}"><span class="fx-rail-l">${esc(s.label)}</span><span class="fx-rail-d" aria-hidden="true"></span></button></li>`).join('')}</ol></nav>`);
  document.body.append(rail);
  rail.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  const syncRail = () => rail.querySelectorAll('button').forEach((b, i) => {
    if (i === S.index) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });

  S.stopListeners.push((i) => { syncDock(); syncRail(); chime(i); });

  /* ---------------------------------------------------------------- inspector */

  const insp = h('<aside class="fx-insp" role="dialog" aria-label="Project inspector" data-lenis-prevent hidden></aside>');
  document.body.append(insp);
  let current = null;

  function openInspector(p, { quiet = false } = {}) {
    current = p;
    S.focus = p.id;
    const rel = related(p);
    const badge = (b) => `<span class="badge ${/ml/i.test(b) ? 'badge-ml' : /sde/i.test(b) ? 'badge-sde' : ''}">${esc(b)}</span>`;
    insp.innerHTML = `
      <header>
        <p class="fx-insp-area">${esc(p.area || 'Project')} · node ${String(p.id + 1).padStart(2, '0')} / ${projects.length}</p>
        <button type="button" class="fx-x" data-i="close" aria-label="Close inspector">${icon(ICONS.close)}</button>
      </header>
      <h3>${esc(p.name)} <span class="fx-insp-year">${esc(p.year)}</span></h3>
      <p class="fx-insp-badges">${p.badges.map(badge).join(' ')}</p>
      ${p.fig ? `<p class="fx-insp-fig"><b>${esc(p.fig)}${esc(p.suffix)}</b><span>${esc(p.label)}</span></p>` : ''}
      <p class="fx-insp-blurb">${esc(p.blurb)}</p>
      <h4>Built with</h4>
      <p class="fx-chips">${p.tokens.map((t) => `<button type="button" data-tech="${esc(t)}">${esc(t)}</button>`).join('')}</p>
      <h4>Connected to ${rel.length} ${rel.length === 1 ? 'project' : 'projects'}</h4>
      ${rel.length ? `<ul class="fx-rel">${rel.slice(0, 6).map((r) =>
        `<li><button type="button" data-open="${r.q.id}"><b>${esc(r.q.name)}</b><span>shares ${esc(r.shared.join(', '))}</span></button></li>`).join('')}</ul>`
        : '<p class="fx-insp-none">Nothing else here uses the same stack.</p>'}
      <div class="fx-insp-acts">
        ${p.href ? `<a class="btn btn-solid" href="${esc(p.href)}" target="_blank" rel="noopener">Code ↗</a>` : `<span class="fx-insp-note">${esc(p.note || 'No public link')}</span>`}
        <button type="button" class="btn" data-i="map">${S.explore ? 'Leave map' : 'Show on map'}</button>
        <button type="button" class="btn" data-i="find">Find in list</button>
      </div>
      <div class="fx-insp-nav">
        <button type="button" class="btn btn-small" data-i="prev">← Previous</button>
        <button type="button" class="btn btn-small" data-i="next">Next →</button>
      </div>`;
    insp.hidden = false;
    root.classList.add('fx-inspecting');
    if (!quiet) insp.querySelector('.fx-x').focus({ preventScroll: true });
  }
  function closeInspector() {
    if (insp.hidden) return;
    insp.hidden = true;
    root.classList.remove('fx-inspecting');
    current = null;
    S.focus = -1;
  }
  function findInList(p) {
    setExplore(false);
    if (p.el.style.display === 'none') document.querySelector('[data-filter="all"]')?.click();
    setTimeout(() => {
      scrollToY(p.el.getBoundingClientRect().top + window.scrollY - innerHeight * 0.35);
      p.el.classList.remove('fx-flash'); void p.el.offsetWidth; p.el.classList.add('fx-flash');
    }, 60);
  }
  insp.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.open) return openInspector(projects[Number(t.dataset.open)]);
    if (t.dataset.tech) return openPalette(t.dataset.tech);
    const n = projects.length;
    switch (t.dataset.i) {
      case 'close': closeInspector(); break;
      case 'map': setExplore(!S.explore); if (current) openInspector(current, { quiet: true }); break;
      case 'find': findInList(current); break;
      case 'prev': openInspector(projects[(current.id + n - 1) % n]); break;
      case 'next': openInspector(projects[(current.id + 1) % n]); break;
    }
  });

  // Any project row or featured card opens its inspector.
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  const projectOf = (el) => {
    const row = el.closest('.row');
    if (row) return projects.find((p) => p.el === row);
    const card = el.closest('.card');
    return card ? byName.get((card.querySelector('h3')?.textContent || '').trim().toLowerCase()) : null;
  };
  document.querySelectorAll('.row, .card').forEach((el) => {
    if (!projectOf(el)) return;
    // Rows become keyboard-reachable; cards are left alone because the page already
    // scrolls the rail to whichever card takes focus.
    if (el.matches('.row')) el.tabIndex = 0;
    el.classList.add('fx-openable');
  });
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const tech = e.target.closest('.skills li, .mq-group li');
    if (tech && !e.target.closest('.fx-insp')) {
      e.stopPropagation();
      return openPalette(tech.textContent.split(/[·/]/)[0].replace(/\(.*?\)/g, '').trim());
    }
    if (e.target.closest('a, button, .fx-insp, .fx-pal, .fx-dock, .fx-stage')) return;
    const p = projectOf(e.target);
    if (p) openInspector(p);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof Element) || !e.target.matches('.fx-openable')) return;
    const p = projectOf(e.target);
    if (p) openInspector(p);
  });

  /* ---------------------------------------------------------------- system map */

  const stage = h(`
    <div class="fx-stage" data-lenis-prevent hidden>
      <div class="fx-stage-head">
        <p class="fx-stage-title">System map</p>
        <p class="fx-stage-sub">${projects.length} projects, ${linkCount} links — two projects are linked when they share a technology. Drag to turn, scroll to zoom, pick a node.</p>
      </div>
      <button type="button" class="btn fx-stage-exit">Back to the page  <kbd>Esc</kbd></button>
      <div class="fx-labels">${projects.map((p) => `<button type="button" class="fx-label" data-node="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    </div>`);
  document.body.append(stage);
  const labels = Array.from(stage.querySelectorAll('.fx-label'));

  function setExplore(on) {
    if (S.explore === on) return;
    S.explore = on;
    stage.hidden = !on;
    root.classList.toggle('fx-explore', on);
    if (on) { stopTour(); S.zoom = 1; S.pitch = 0; } else if (insp.hidden) S.focus = -1;
    syncDock();
  }
  stage.querySelector('.fx-stage-exit').addEventListener('click', () => setExplore(false));
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('.fx-label');
    if (b) openInspector(projects[Number(b.dataset.node)], { quiet: true });
  });
  labels.forEach((b) => {
    b.addEventListener('pointerenter', () => { S.focus = Number(b.dataset.node); });
    b.addEventListener('pointerleave', () => { S.focus = current ? current.id : -1; });
  });

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY };
    S.dragging = true;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('grabbing');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    S.yaw += (e.clientX - drag.x) * 0.006;
    S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  });
  const drop = () => { drag = null; S.dragging = false; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.zoom = Math.max(0.55, Math.min(1.9, S.zoom * (e.deltaY > 0 ? 0.93 : 1.07)));
  }, { passive: false });

  S.frameListeners.push((ex, dt) => {
    if (touring) {
      if (paused()) stopTour();
      else {
        tourAcc += 150 * dt * Math.max(0.7, S.energy);
        const px = Math.floor(tourAcc);
        if (px) { window.scrollBy(0, px); tourAcc -= px; }
        if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2) { stopTour(); toast('End of the tour'); }
      }
    }
    if (audio && soundOn) audio.filter.frequency.setTargetAtTime(240 + Math.abs(S.vel) * 2600 + S.index * 45, audio.ctx.currentTime, 0.15);
    if (ex < 0.02) return;
    for (let i = 0; i < labels.length; i++) {
      const s = S.nodeScreen(i);
      if (!s) continue;
      const near = Math.max(0, Math.min(1, (s.depth + 1) / 2));
      const el = labels[i];
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      el.style.opacity = ((0.3 + near * 0.7) * ex).toFixed(2);
      el.style.zIndex = String(Math.round(near * 100));
      el.classList.toggle('on', S.focus === i);
    }
  });

  /* ---------------------------------------------------------------- palette */

  const pal = h(`
    <div class="fx-pal" role="dialog" aria-modal="true" aria-label="Command palette" hidden>
      <div class="fx-pal-box">
        <input type="text" class="fx-pal-in" role="combobox" aria-expanded="true" aria-controls="fx-pal-list" aria-autocomplete="list"
          placeholder="Jump to a section, project, technology or action…" autocomplete="off" spellcheck="false">
        <ul class="fx-pal-list" id="fx-pal-list" role="listbox" data-lenis-prevent></ul>
        <p class="fx-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></p>
      </div>
    </div>`);
  document.body.append(pal);
  const palIn = pal.querySelector('input'), palList = pal.querySelector('ul');

  const lens = Array.from(document.querySelectorAll('[data-lens-link]'));
  const items = [
    ...stops.map((s, i) => ({ g: 'Go to', t: s.label, hint: s.shape, kw: 'section jump ' + s.sel, run: () => go(i) })),
    { g: 'Go to', t: 'Next section', keys: 'J', kw: 'down', run: () => step(1) },
    { g: 'Go to', t: 'Previous section', keys: 'K', kw: 'up', run: () => step(-1) },
    ...lens.map((a, i) => ({ g: 'View', t: `${a.textContent.trim()} view`, keys: String(i + 1), hint: a.getAttribute('aria-current') ? 'current' : '', kw: 'lens role switch', run: () => { location.href = a.href; } })),
    { g: 'Scene', t: 'Open the system map', keys: 'M', kw: 'graph explore machine architecture nodes 3d', run: () => setExplore(true) },
    { g: 'Scene', t: 'Next scene', keys: 'S', kw: 'shape cycle', run: nextScene },
    { g: 'Scene', t: 'Scene follows the page', kw: 'auto reset unpin', run: () => setScene(-1) },
    ...stops.map((s, i) => ({ g: 'Scene', t: `Pin scene: ${cap(s.shape)}`, kw: 'shape swarm', run: () => setScene(i) })),
    ...ENERGY.map(([name, v]) => ({ g: 'Scene', t: `Energy: ${name}`, keys: name === 'Wild' ? 'W' : '', kw: 'speed intensity turbulence', run: () => setEnergy(v) })),
    { g: 'Scene', t: 'Shatter the swarm', keys: 'X', kw: 'explode scatter reassemble', run: shatter },
    { g: 'Scene', t: 'Start or stop the tour', keys: 'T', kw: 'autoplay autoscroll cinematic', run: toggleTour },
    { g: 'Scene', t: 'Sound on or off', kw: 'audio music mute', run: toggleSound },
    { g: 'Scene', t: 'Pause or resume motion', kw: 'stop animation freeze', run: () => document.querySelector('[data-pause]')?.click() },
    ...(email ? [
      { g: 'Contact', t: 'Copy email address', keys: 'E', hint: email, kw: 'mail', run: () => copy(email, 'Email copied') },
      { g: 'Contact', t: 'Write an email', kw: 'mail compose hire', run: () => { location.href = 'mailto:' + email; } },
    ] : []),
    ...(github ? [{ g: 'Contact', t: 'Open GitHub', keys: 'G', kw: 'code repos', run: () => window.open(github, '_blank', 'noopener') }] : []),
    ...(linkedin ? [{ g: 'Contact', t: 'Open LinkedIn', kw: 'profile', run: () => window.open(linkedin, '_blank', 'noopener') }] : []),
    { g: 'Contact', t: 'Copy a link to this section', kw: 'share url', run: () => {
      const id = stops[S.index].el.id;
      copy(location.origin + location.pathname + (id && id !== 'top' ? '#' + id : ''), 'Link copied');
    } },
    ...projects.map((p) => ({ g: 'Projects', t: p.name, hint: p.tokens.join(' · '), kw: `${p.stack} ${p.area} ${p.filters.join(' ')} ${p.badges.join(' ')} ${p.year}`, run: () => openInspector(p) })),
  ];
  items.forEach((it) => { it.hay = `${it.g} ${it.t} ${it.hint || ''} ${it.kw || ''}`.toLowerCase(); });

  let shown = [], sel = 0, lastFocus = null;
  function renderPalette() {
    const words = palIn.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = items.filter((it) => words.every((w) => it.hay.includes(w)));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let group = '', html = '';
    shown.forEach((it, i) => {
      if (it.g !== group) { group = it.g; html += `<li class="fx-pal-g" role="presentation">${esc(group)}</li>`; }
      html += `<li role="option" id="fx-opt-${i}" data-i="${i}" aria-selected="${i === sel}"><span class="fx-pal-t">${esc(it.t)}</span>${it.hint ? `<span class="fx-pal-h">${esc(it.hint)}</span>` : ''}${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ''}</li>`;
    });
    palList.innerHTML = html || '<li class="fx-pal-none" role="presentation">Nothing matches. Try a project, a technology or “map”.</li>';
    palIn.setAttribute('aria-activedescendant', shown.length ? `fx-opt-${sel}` : '');
    palList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function openPalette(query) {
    if (pal.hidden) lastFocus = document.activeElement;
    pal.hidden = false;
    palIn.value = query;
    sel = 0;
    renderPalette();
    palIn.focus({ preventScroll: true });
    palIn.select();
  }
  function closePalette(restore = true) {
    if (pal.hidden) return;
    pal.hidden = true;
    if (restore && lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
  }
  const runSelected = () => { const it = shown[sel]; if (!it) return; closePalette(false); it.run(); };
  palIn.addEventListener('input', () => { sel = 0; renderPalette(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      renderPalette();
    } else if (e.key === 'Enter') { e.preventDefault(); runSelected(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  palList.addEventListener('pointermove', (e) => {
    const li = e.target.closest('[data-i]');
    if (li && Number(li.dataset.i) !== sel) { sel = Number(li.dataset.i); renderPalette(); }
  });
  palList.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) { sel = Number(li.dataset.i); runSelected(); }
  });
  pal.addEventListener('pointerdown', (e) => { if (e.target === pal) closePalette(); });

  /* ---------------------------------------------------------------- keyboard */

  const KEYS = {
    '/': () => openPalette(''), '?': () => openPalette(''),
    j: () => step(1), k: () => step(-1), ']': () => step(1), '[': () => step(-1),
    m: () => setExplore(!S.explore), s: nextScene, w: nextEnergy, x: shatter, t: toggleTour,
    e: () => email && copy(email, 'Email copied'),
    g: () => github && window.open(github, '_blank', 'noopener'),
    1: () => lens[0] && (location.href = lens[0].href), 2: () => lens[1] && (location.href = lens[1].href), 3: () => lens[2] && (location.href = lens[2].href),
  };
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette('') : closePalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape') {
      if (!insp.hidden) closeInspector(); else if (S.explore) setExplore(false); else stopTour();
      return;
    }
    const fn = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (touring && e.key.toLowerCase() !== 't') stopTour();
    if (fn) { e.preventDefault(); fn(); }
  });

  syncDock();
  syncRail();
  root.classList.add('fx-deck');
}
