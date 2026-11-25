"use strict";
(() => {
  // ---------- Languages ----------
  const LANGS = {
    pt: { name: "Português", rec: "pt-BR", voice: "pt-BR", g: "pt", mm: "pt-BR" },
    en: { name: "Inglês", rec: "en-US", voice: "en-US", g: "en", mm: "en-US", label: "Other person" },
    es: { name: "Espanhol", rec: "es-ES", voice: "es-ES", g: "es", mm: "es-ES", label: "Otra persona" },
    fr: { name: "Francês", rec: "fr-FR", voice: "fr-FR", g: "fr", mm: "fr-FR", label: "L'autre personne" },
    it: { name: "Italiano", rec: "it-IT", voice: "it-IT", g: "it", mm: "it-IT", label: "L'altra persona" },
    de: { name: "Alemão", rec: "de-DE", voice: "de-DE", g: "de", mm: "de-DE", label: "Die andere Person" },
    zh: { name: "Chinês", rec: "zh-CN", voice: "zh-CN", g: "zh-CN", mm: "zh-CN", label: "对方" },
    ja: { name: "Japonês", rec: "ja-JP", voice: "ja-JP", g: "ja", mm: "ja-JP", label: "相手の方" },
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const other = () => $("other").value;
  const dir = (side) => (side === "me" ? { from: "pt", to: other() } : { from: other(), to: "pt" });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;

  let cur = null;          // turn being listened to: {side, rec, text, partial, cancelled}
  let working = false;     // translating
  let speaking = false;
  let silenceTimer = null;
  let wakeLock = null;
  let log = store.get("conv.log", []);

  // ---------- UI ----------
  function setStatus(t, live) { $("status").textContent = t; $("status").classList.toggle("live", !!live); }
  function updateLabels() {
    const o = LANGS[other()];
    $("hintMe").textContent = "Português → " + o.name;
    $("hintThem").textContent = o.name + " → Português";
    $("whoThem").textContent = o.label;
    store.set("conv.other", other());
  }
  function renderPads() {
    for (const side of ["me", "them"]) {
      const pad = side === "me" ? $("padMe") : $("padThem");
      const on = !!cur && cur.side === side;
      pad.classList.toggle("on", on);
      pad.setAttribute("aria-pressed", String(on));
      pad.disabled = working;
    }
  }
  function renderLive() {
    const el = $("liveText");
    el.textContent = "";
    if (!cur) return;
    el.append(document.createTextNode(cur.text));
    if (cur.partial) { const s = document.createElement("span"); s.className = "partial"; s.textContent = (cur.text ? " " : "") + cur.partial; el.append(s); }
  }
  function renderLog() {
    const box = $("log");
    box.textContent = "";
    if (!log.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "As frases traduzidas aparecem aqui, a mais recente no alto."; box.append(p); return; }
    for (const item of log) box.append(cardFor(item));
  }
  function cardFor(item) {
    const c = document.createElement("article"); c.className = "card " + item.side;
    const o = document.createElement("div"); o.className = "orig"; o.textContent = item.orig;
    const t = document.createElement("div"); t.className = "tr"; t.textContent = item.tr;
    const m = document.createElement("div"); m.className = "meta";
    const tag = document.createElement("span"); tag.className = "tag";
    tag.textContent = (LANGS[item.from]?.name || item.from) + " → " + (LANGS[item.to]?.name || item.to);
    const play = document.createElement("button"); play.type = "button"; play.className = "play"; play.textContent = "Ouvir de novo";
    play.onclick = () => { stopListening(true); speak(item.tr, item.to); };
    m.append(tag, play); c.append(o, t, m);
    item._el = t;
    return c;
  }
  const saveLog = () => store.set("conv.log", log.slice(0, 40).map(({ _el, ...r }) => r));

  // ---------- Voice output ----------
  let voices = [];
  const loadVoices = () => { try { voices = synth ? synth.getVoices() : []; } catch { voices = []; } };
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function pickVoice(tag) {
    if (!voices.length) loadVoices();
    const t = tag.toLowerCase().replace("_", "-"), base = t.split("-")[0];
    const norm = (v) => v.lang.toLowerCase().replace("_", "-");
    return voices.find((v) => norm(v) === t && v.localService) || voices.find((v) => norm(v) === t)
      || voices.find((v) => norm(v).split("-")[0] === base) || null;
  }
  function unlockAudio() {           // iOS only lets speech start inside a tap; prime it once
    if (!synth || unlockAudio.done) return;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); unlockAudio.done = true; } catch {}
  }
  function speak(text, lang) {
    return new Promise((resolve) => {
      if (!synth || !text) return resolve();
      try { synth.cancel(); } catch {}
      const u = new SpeechSynthesisUtterance(text);
      const tag = LANGS[lang]?.voice || lang;
      u.lang = tag;
      const v = pickVoice(tag); if (v) u.voice = v;
      u.rate = parseFloat($("rate").value);
      let done = false;
      const finish = () => { if (done) return; done = true; speaking = false; clearTimeout(guard); resolve(); };
      // Some Android builds never fire onend: give up after a generous estimate.
      const guard = setTimeout(finish, 4000 + text.length * 120 / u.rate);
      u.onend = finish; u.onerror = finish;
      speaking = true;
      synth.speak(u);
    });
  }

  // ---------- Translation ----------
  async function withTimeout(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function translate(text, from, to) {
    const F = LANGS[from], T = LANGS[to];
    try {
      const url = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" + F.g + "&tl=" + T.g + "&q=" + encodeURIComponent(text);
      const j = await withTimeout(url, 8000);
      const out = (j?.[0] || []).map((seg) => seg?.[0] || "").join("").trim();
      if (out) return out;
      throw new Error("empty");
    } catch {
      const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + F.mm + "|" + T.mm;
      const j = await withTimeout(url, 10000);
      const out = (j?.responseData?.translatedText || "").trim();
      if (!out || j.responseStatus >= 400) throw new Error("translate failed");
      return out;
    }
  }

  async function handleUtterance(text, side, fromTyping) {
    const { from, to } = dir(side);
    const item = { side, from, to, orig: text, tr: "…" };
    log.unshift(item); log = log.slice(0, 40); renderLog();
    working = true; renderPads();
    setStatus("Traduzindo…");
    try {
      item.tr = await translate(text, from, to);
    } catch {
      item.tr = "";
      item._el.textContent = navigator.onLine === false ? "Sem internet: a tradução precisa de conexão." : "Não foi possível traduzir. Tente de novo.";
      working = false; renderPads(); setStatus("A tradução falhou.");
      return;
    }
    item._el.textContent = item.tr;
    saveLog();
    working = false; renderPads();
    setStatus("Falando a tradução…");
    await speak(item.tr, to);
    if (cur || working) return;
    if ($("auto").checked && !fromTyping) {
      setTimeout(() => { if (!cur && !working && !speaking) startListening(side === "me" ? "them" : "me", true); }, 300);
    } else {
      setStatus("Toque em quem vai falar.");
    }
  }

  // ---------- Listening ----------
  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => { if (cur && (cur.text || cur.partial)) { try { cur.rec.stop(); } catch {} } }, parseFloat($("pause").value) * 1000);
  }
  function stopListening(cancel) {
    clearTimeout(silenceTimer);
    if (!cur) return;
    cur.cancelled = !!cancel;
    try { cancel ? cur.rec.abort() : cur.rec.stop(); } catch {}
  }
  async function keepAwake() {
    try { if (!wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch {}
  }

  function startListening(side, automatic) {
    if (!SR) { $("noMic").hidden = false; $("typed").focus(); return; }
    try { synth?.cancel(); } catch {}
    speaking = false;
    const { from } = dir(side);
    const rec = new SR();
    rec.lang = LANGS[from].rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const turn = { side, rec, text: "", partial: "", cancelled: false, heard: false };
    cur = turn;

    rec.onstart = () => {
      if (cur !== turn) return;
      setStatus(side === "me" ? "Ouvindo você… faça uma pausa ao terminar." : "Ouvindo a outra pessoa (" + LANGS[from].name + ")…", true);
    };
    rec.onresult = (e) => {
      if (cur !== turn) return;
      let fin = "", part = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += (fin ? " " : "") + r[0].transcript.trim();
        else part += (part ? " " : "") + r[0].transcript.trim();
      }
      turn.text = fin; turn.partial = part; turn.heard = true;
      renderLive(); armSilence();
    };
    rec.onerror = (e) => { turn.error = e.error; };
    rec.onend = () => {
      clearTimeout(silenceTimer);
      if (cur === turn) cur = null;
      renderPads(); renderLive();
      if (turn.cancelled) return;
      const text = [turn.text, turn.partial].filter(Boolean).join(" ").trim();
      if (text) return handleUtterance(text, side, false);
      const err = turn.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setStatus(automatic ? "Toque em quem vai falar." : "O microfone foi bloqueado. Libere o microfone para este site nas configurações do navegador.");
      } else if (err === "network") setStatus("O reconhecimento de voz precisa de internet.");
      else if (err === "language-not-supported") setStatus("Este telefone não reconhece fala em " + LANGS[from].name + ". Use o campo de texto.");
      else setStatus(automatic ? "Ninguém falou. Toque em quem vai falar." : "Não ouvi nada. Toque e fale de novo.");
    };

    renderPads(); renderLive();
    setStatus("Abrindo o microfone…", true);
    try { rec.start(); } catch { cur = null; renderPads(); setStatus("Toque em quem vai falar."); }
  }

  function onPad(side) {
    unlockAudio(); keepAwake();
    if (working) return;
    if (cur) {
      if (cur.side === side) { stopListening(false); return; }        // same side: done talking
      if (cur.text || cur.partial) { stopListening(false); return; }  // other side but words heard: finish them first
      const old = cur; old.cancelled = true; cur = null;
      try { old.rec.abort(); } catch {}
    }
    startListening(side, false);
  }

  // ---------- Wiring ----------
  $("padMe").addEventListener("click", () => onPad("me"));
  $("padThem").addEventListener("click", () => onPad("them"));
  const saved = store.get("conv.other", "en");
  $("other").value = LANGS[saved] ? saved : "en";
  $("other").addEventListener("change", updateLabels);
  $("pause").value = store.get("conv.pause", 1.5);
  $("rate").value = store.get("conv.rate", 1);
  $("auto").checked = store.get("conv.auto", true);
  const fmt = () => {
    $("pauseVal").textContent = parseFloat($("pause").value).toFixed(1).replace(".", ",") + " s";
    $("rateVal").textContent = parseFloat($("rate").value).toFixed(2).replace(/0$/, "").replace(".", ",") + "×";
  };
  $("pause").addEventListener("input", () => { fmt(); store.set("conv.pause", +$("pause").value); });
  $("rate").addEventListener("input", () => { fmt(); store.set("conv.rate", +$("rate").value); });
  $("auto").addEventListener("change", () => store.set("conv.auto", $("auto").checked));
  $("clear").addEventListener("click", () => { log = []; saveLog(); renderLog(); });
  $("typedForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    unlockAudio();
    const side = ev.submitter?.dataset.side || "me";
    const text = $("typed").value.trim();
    if (!text || working) return;
    stopListening(true);
    $("typed").value = "";
    handleUtterance(text, side, true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopListening(true);
    else if (wakeLock === null && cur) keepAwake();
  });

  if (!SR) $("noMic").hidden = false;

  // Install hints
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const tip = $("installTip");
  if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
    tip.textContent = "Para instalar no iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.";
    tip.hidden = false;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    tip.textContent = "";
    const b = document.createElement("button"); b.className = "btn primary"; b.type = "button"; b.textContent = "Instalar o app no telefone";
    b.onclick = async () => { e.prompt(); try { await e.userChoice; } catch {} tip.hidden = true; };
    tip.append(b); tip.hidden = false;
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  fmt(); updateLabels(); renderLog(); renderPads();
})();
