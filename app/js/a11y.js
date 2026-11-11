/* CureBranch shared accessibility + read-aloud. Free Web Speech API only. */
(function () {
  "use strict";
  var KEY = "curebranch-a11y-v1";
  var SCALES = [100, 125, 150, 175, 200];
  var defaults = {
    textScale: 100,
    font: "default",
    lineHeight: "default",
    letterSpacing: "default",
    theme: "default",
    customOn: false,
    customText: "#1c2a2a",
    customBg: "#f7f8f6",
    customAccent: "#1f5e4f",
    reduceMotion: "system", /* system | on | off */
    underlineLinks: false,
    bigCursorFocus: false,
    speechRate: "1"
  };

  function load() {
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch (e) {
      return Object.assign({}, defaults);
    }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function lum(hex) {
    if (!hex || hex.length < 7) return 0;
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    function f(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) {
    var L1 = lum(a), L2 = lum(b);
    var hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function mixMuted(textHex, bgHex) {
    /* Mid tone that still aims for 4.5:1 on the background */
    var t = textHex, b = bgHex;
    /* Prefer a slightly softened text color if contrast allows; else use text */
    return contrast(t, b) >= 4.5 ? t : (lum(b) > 0.5 ? "#000000" : "#ffffff");
  }
  function btnFg(accent, bg) {
    var white = contrast("#ffffff", accent);
    var black = contrast("#000000", accent);
    return white >= black ? "#ffffff" : "#000000";
  }

  var settings = load();

  function apply(s) {
    settings = s;
    var root = document.documentElement;
    root.style.setProperty("--text-scale", String(s.textScale / 100));
    root.style.fontSize = (16 * s.textScale / 100) + "px";

    var lh = { default: "1.6", "1.6": "1.6", "1.8": "1.8", "2": "2" }[s.lineHeight] || "1.6";
    var ls = { default: "0", "0.04": "0.04em", "0.08": "0.08em", "0.12": "0.12em" }[s.letterSpacing] || "0";
    root.style.setProperty("--lh", lh);
    root.style.setProperty("--ls", ls);

    var font = s.font || "default";
    if (font === "default") root.removeAttribute("data-cb-font");
    else root.setAttribute("data-cb-font", font);

    var theme = s.theme || "default";
    if (theme === "default") root.removeAttribute("data-cb-theme");
    else root.setAttribute("data-cb-theme", theme);

    /* Clear previous custom inline vars when custom is off, so themes work */
    var customVars = ["--ink", "--bg", "--surface", "--muted", "--green", "--green-d", "--green-l",
      "--focus", "--btn-fg", "--sky", "--sky-d", "--footer-bg", "--footer-fg", "--footer-link"];
    if (s.customOn) {
      var text = s.customText || "#1c2a2a";
      var bg = s.customBg || "#f7f8f6";
      var accent = s.customAccent || "#1f5e4f";
      root.style.setProperty("--ink", text);
      root.style.setProperty("--bg", bg);
      root.style.setProperty("--surface", bg);
      root.style.setProperty("--muted", mixMuted(text, bg));
      root.style.setProperty("--green", accent);
      root.style.setProperty("--green-d", accent);
      root.style.setProperty("--focus", accent);
      root.style.setProperty("--btn-fg", btnFg(accent, bg));
      root.style.setProperty("--sky-d", accent);
      root.style.setProperty("--footer-bg", text);
      root.style.setProperty("--footer-fg", bg);
      root.style.setProperty("--footer-link", bg);
      var warn = document.getElementById("a11y-contrast-warn");
      if (warn) {
        var c = contrast(text, bg);
        var ca = Math.min(contrast(btnFg(accent, bg), accent), contrast(accent, bg));
        if (c < 4.5 || contrast(accent, bg) < 3) {
          warn.classList.add("show");
          warn.textContent = "These custom colors are under a 4.5:1 contrast ratio (currently " + c.toFixed(1) + ":1 for text). Text may be hard to read. Try a darker text or a lighter background.";
        } else {
          warn.classList.remove("show");
        }
      }
    } else {
      customVars.forEach(function (v) { root.style.removeProperty(v); });
      var warn2 = document.getElementById("a11y-contrast-warn");
      if (warn2) warn2.classList.remove("show");
    }

    if (s.reduceMotion === "on") root.setAttribute("data-cb-motion", "on");
    else if (s.reduceMotion === "off") root.setAttribute("data-cb-motion", "off");
    else root.removeAttribute("data-cb-motion");

    root.classList.toggle("cb-underline", !!s.underlineLinks);
    root.classList.toggle("cb-big-cursor", !!s.bigCursorFocus);
    root.classList.toggle("cb-big-focus", !!s.bigCursorFocus);

    document.body && (document.body.style.lineHeight = "var(--lh)");
    document.body && (document.body.style.letterSpacing = "var(--ls)");
    document.body && (document.body.style.fontFamily = "var(--font-sans)");

    syncPanel(s);
    save(s);
  }

  function val(id) { return document.getElementById(id); }

  function syncPanel(s) {
    var scaleOut = val("a11y-scale-out");
    if (scaleOut) scaleOut.value = s.textScale + "%";
    var font = val("a11y-font");
    if (font) font.value = s.font;
    var lh = val("a11y-lh");
    if (lh) lh.value = s.lineHeight;
    var ls = val("a11y-ls");
    if (ls) ls.value = s.letterSpacing;
    document.querySelectorAll("input[name='a11y-theme']").forEach(function (r) {
      r.checked = r.value === s.theme;
    });
    var cOn = val("a11y-custom-on");
    if (cOn) cOn.checked = !!s.customOn;
    var ct = val("a11y-color-text"), cb = val("a11y-color-bg"), ca = val("a11y-color-accent");
    if (ct) ct.value = s.customText;
    if (cb) cb.value = s.customBg;
    if (ca) ca.value = s.customAccent;
    document.querySelectorAll("input[name='a11y-motion']").forEach(function (r) {
      r.checked = r.value === s.reduceMotion;
    });
    var ul = val("a11y-underline");
    if (ul) ul.setAttribute("aria-checked", s.underlineLinks ? "true" : "false");
    var big = val("a11y-bigcursor");
    if (big) big.setAttribute("aria-checked", s.bigCursorFocus ? "true" : "false");
  }

  /* ---------- Speech (Web Speech API) ---------- */
  var speech = {
    supported: typeof window !== "undefined" && "speechSynthesis" in window,
    queue: [],
    index: 0,
    rate: 1,
    bar: null,
    paused: false,
    utter: null
  };

  function setStatus(bar, msg) {
    if (!bar) return;
    var s = bar.querySelector(".listen-status");
    if (s) s.textContent = msg || "";
  }
  function setButtons(bar, state) {
    if (!bar) return;
    var play = bar.querySelector('[data-act="play"]');
    var pause = bar.querySelector('[data-act="pause"]');
    var stop = bar.querySelector('[data-act="stop"]');
    if (play) play.disabled = state === "play";
    if (pause) {
      pause.disabled = state !== "play" && state !== "pause";
      pause.textContent = state === "pause" ? "Resume" : "Pause";
      pause.setAttribute("aria-label", state === "pause" ? "Resume read-aloud" : "Pause read-aloud");
    }
    if (stop) stop.disabled = state === "idle";
  }
  function stopSpeech() {
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {}
    speech.queue = [];
    speech.index = 0;
    speech.paused = false;
    speech.utter = null;
    if (speech.bar) {
      setButtons(speech.bar, "idle");
      setStatus(speech.bar, "");
    }
    speech.bar = null;
  }
  function chunkText(text) {
    var parts = text.match(/[^.!?]+[.!?]+|\S[^.!?]*/g) || [text];
    var chunks = [], buf = "";
    parts.forEach(function (p) {
      if ((buf + " " + p).trim().length > 240) {
        if (buf.trim()) chunks.push(buf.trim());
        buf = p;
      } else buf += " " + p;
    });
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }
  function textOf(target) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return "";
    var clone = el.cloneNode(true);
    clone.querySelectorAll(".listen-bar, .a11y-panel, .a11y-backdrop, .a11y-launch, .skip-link, script, style, noscript, nav.tabs, .status, .sr-only").forEach(function (n) { n.remove(); });
    var t = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    return t;
  }
  /* Pick the most natural-sounding voice the device offers. Free, on-device:
     prefers voices whose names say Enhanced / Premium / Natural / Neural, then
     the language match, then local (offline) voices. Returns null to use the default. */
  var bestVoiceCache = null;
  function bestVoice(lang) {
    if (bestVoiceCache && bestVoiceCache.lang === lang) return bestVoiceCache.voice;
    var voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch (e) { return null; }
    if (!voices.length) return null;
    var base = (lang || "en").toLowerCase().split("-")[0];
    function score(v) {
      var n = (v.name || "").toLowerCase(), l = (v.lang || "").toLowerCase(), sc = 0;
      if (l.split(/[-_]/)[0] !== base) return -1;
      if (/natural|neural/.test(n)) sc += 40;
      if (/premium/.test(n)) sc += 35;
      if (/enhanced/.test(n)) sc += 30;
      if (/google/.test(n)) sc += 10;
      if (v.localService) sc += 5;
      if (l === (lang || "").toLowerCase()) sc += 3;
      if (v["default"]) sc += 1;
      return sc;
    }
    var best = null, bestScore = -1;
    voices.forEach(function (v) { var s = score(v); if (s > bestScore) { best = v; bestScore = s; } });
    bestVoiceCache = { lang: lang, voice: best };
    return best;
  }
  if (typeof speechSynthesis !== "undefined" && "onvoiceschanged" in speechSynthesis) {
    speechSynthesis.addEventListener("voiceschanged", function () { bestVoiceCache = null; });
  }
  function speakNext() {
    if (!speech.queue.length || speech.index >= speech.queue.length) {
      if (speech.bar) {
        setButtons(speech.bar, "idle");
        setStatus(speech.bar, "Finished reading.");
      }
      speech.bar = null;
      return;
    }
    var u = new SpeechSynthesisUtterance(speech.queue[speech.index]);
    u.rate = speech.rate;
    u.lang = document.documentElement.lang || "en";
    var v = bestVoice(u.lang);
    if (v) u.voice = v;
    speech.utter = u;
    u.onend = function () {
      if (speech.paused) return;
      speech.index += 1;
      speakNext();
    };
    u.onerror = function () {
      speech.index += 1;
      speakNext();
    };
    speechSynthesis.speak(u);
  }
  function play(bar) {
    if (!speech.supported) return;
    var sel = bar.getAttribute("data-listen-for");
    var target = sel ? document.querySelector(sel) : bar.closest("section, main, footer, .screen") || document.body;
    var text = textOf(target);
    if (!text) {
      setStatus(bar, "Nothing to read in this section.");
      return;
    }
    if (speech.bar && speech.bar !== bar) stopSpeech();
    if (speech.paused && speech.bar === bar) {
      try { speechSynthesis.resume(); } catch (e) {}
      speech.paused = false;
      setButtons(bar, "play");
      setStatus(bar, "Reading…");
      /* If resume is a no-op (known in some Chromium builds), restart */
      setTimeout(function () {
        if (speech.bar === bar && !speech.paused && speechSynthesis && !speechSynthesis.speaking && !speechSynthesis.pending) {
          speakNext();
        }
      }, 80);
      return;
    }
    stopSpeech();
    var speedSel = bar.querySelector(".listen-speed select");
    speech.rate = parseFloat((speedSel && speedSel.value) || settings.speechRate || "1") || 1;
    speech.queue = chunkText(text);
    speech.index = 0;
    speech.bar = bar;
    speech.paused = false;
    setButtons(bar, "play");
    setStatus(bar, "Reading… Voices depend on your device and browser.");
    /* Some browsers need a voices warmup */
    try { speechSynthesis.getVoices(); } catch (e) {}
    speakNext();
  }
  function pause(bar) {
    if (!speech.supported || speech.bar !== bar) return;
    if (speech.paused) {
      play(bar);
      return;
    }
    speech.paused = true;
    try { speechSynthesis.pause(); } catch (e) {}
    setButtons(bar, "pause");
    setStatus(bar, "Paused.");
  }

  function wireListenBars() {
    document.querySelectorAll(".listen-bar").forEach(function (bar) {
      if (!speech.supported) {
        bar.classList.add("is-unsupported");
        setStatus(bar, "Read aloud isn’t available in this browser. Try Chrome, Edge, Safari, or Firefox — or use your device’s built-in screen reader (VoiceOver, Narrator, NVDA, or TalkBack).");
        return;
      }
      bar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-act]");
        if (!btn) return;
        var act = btn.getAttribute("data-act");
        if (act === "play") play(bar);
        else if (act === "pause") pause(bar);
        else if (act === "stop") {
          stopSpeech();
          setButtons(bar, "idle");
          setStatus(bar, "Stopped.");
        }
      });
      var sel = bar.querySelector(".listen-speed select");
      if (sel) {
        sel.value = settings.speechRate || "1";
        sel.addEventListener("change", function () {
          settings.speechRate = sel.value;
          save(settings);
          speech.rate = parseFloat(sel.value) || 1;
        });
      }
    });
  }

  /* ---------- Panel open/close + focus trap ---------- */
  var lastFocus = null;
  function panelEls() {
    return {
      panel: val("a11y-panel"),
      backdrop: val("a11y-backdrop")
    };
  }
  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !el.hasAttribute("hidden") && el.offsetParent !== null || el.tagName === "INPUT"; });
  }
  function openPanel() {
    var p = panelEls();
    if (!p.panel) return;
    lastFocus = document.activeElement;
    p.panel.hidden = false;
    p.backdrop && (p.backdrop.hidden = false);
    p.panel.removeAttribute("hidden");
    if (p.backdrop) p.backdrop.removeAttribute("hidden");
    document.body.style.overflow = "hidden";
    var close = p.panel.querySelector(".a11y-close");
    (close || p.panel).focus();
  }
  function closePanel() {
    var p = panelEls();
    if (!p.panel) return;
    p.panel.hidden = true;
    p.backdrop && (p.backdrop.hidden = true);
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function isPanelOpen() {
    var p = val("a11y-panel");
    return p && !p.hidden;
  }

  function bumpScale(dir) {
    var i = SCALES.indexOf(settings.textScale);
    if (i < 0) i = 0;
    i = Math.max(0, Math.min(SCALES.length - 1, i + dir));
    settings.textScale = SCALES[i];
    apply(settings);
  }

  function wirePanel() {
    document.querySelectorAll(".a11y-launch").forEach(function (b) {
      b.addEventListener("click", openPanel);
    });
    var p = panelEls();
    if (!p.panel) return;
    p.panel.querySelectorAll(".a11y-close").forEach(function (b) { b.addEventListener("click", closePanel); });
    if (p.backdrop) p.backdrop.addEventListener("click", closePanel);

    var dec = val("a11y-scale-dec"), inc = val("a11y-scale-inc");
    if (dec) dec.addEventListener("click", function () { bumpScale(-1); });
    if (inc) inc.addEventListener("click", function () { bumpScale(1); });

    ["a11y-font", "a11y-lh", "a11y-ls"].forEach(function (id) {
      var el = val(id);
      if (!el) return;
      el.addEventListener("change", function () {
        if (id === "a11y-font") settings.font = el.value;
        if (id === "a11y-lh") settings.lineHeight = el.value;
        if (id === "a11y-ls") settings.letterSpacing = el.value;
        apply(settings);
      });
    });
    document.querySelectorAll("input[name='a11y-theme']").forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { settings.theme = r.value; apply(settings); }
      });
    });
    var cOn = val("a11y-custom-on");
    if (cOn) cOn.addEventListener("change", function () { settings.customOn = cOn.checked; apply(settings); });
    ["a11y-color-text", "a11y-color-bg", "a11y-color-accent"].forEach(function (id) {
      var el = val(id);
      if (!el) return;
      el.addEventListener("input", function () {
        if (id.indexOf("text") >= 0) settings.customText = el.value;
        else if (id.indexOf("bg") >= 0) settings.customBg = el.value;
        else settings.customAccent = el.value;
        apply(settings);
      });
    });
    document.querySelectorAll("input[name='a11y-motion']").forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { settings.reduceMotion = r.value; apply(settings); }
      });
    });
    function wireSwitch(id, key) {
      var el = val(id);
      if (!el) return;
      el.addEventListener("click", function () {
        var on = el.getAttribute("aria-checked") !== "true";
        el.setAttribute("aria-checked", on ? "true" : "false");
        settings[key] = on;
        apply(settings);
      });
    }
    wireSwitch("a11y-underline", "underlineLinks");
    wireSwitch("a11y-bigcursor", "bigCursorFocus");

    var reset = val("a11y-reset");
    if (reset) reset.addEventListener("click", function () {
      settings = Object.assign({}, defaults);
      apply(settings);
      stopSpeech();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isPanelOpen()) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (e.key !== "Tab" || !isPanelOpen()) return;
      var list = focusables(val("a11y-panel"));
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function panelHTML() {
    return (
      '<div class="a11y-backdrop" id="a11y-backdrop" hidden></div>' +
      '<div class="a11y-panel" id="a11y-panel" hidden role="dialog" aria-modal="true" aria-labelledby="a11y-title" tabindex="-1">' +
      '  <div class="a11y-panel-head">' +
      '    <h2 id="a11y-title">Accessibility settings</h2>' +
      '    <button type="button" class="a11y-close" aria-label="Close accessibility settings">&times;</button>' +
      '  </div>' +
      '  <p class="hint">These options stay on this device. They use only built-in browser features — nothing is paid, and nothing is sent to a server.</p>' +
      '  <div class="a11y-fieldset"><legend>Text size</legend>' +
      '    <div class="a11y-step">' +
      '      <button type="button" class="a11y-step-btn" id="a11y-scale-dec" aria-label="Smaller text">−</button>' +
      '      <output id="a11y-scale-out" for="a11y-scale-dec a11y-scale-inc" aria-live="polite">100%</output>' +
      '      <button type="button" class="a11y-step-btn" id="a11y-scale-inc" aria-label="Larger text">+</button>' +
      '    </div>' +
      '    <p class="hint">Five sizes, from 100% up to 200%.</p>' +
      '  </div>' +
      '  <div class="a11y-fieldset"><legend>Font</legend>' +
      '    <label class="sr-only" for="a11y-font">Font</label>' +
      '    <select class="full" id="a11y-font">' +
      '      <option value="default">Default (Mona Sans)</option>' +
      '      <option value="system">System font</option>' +
      '      <option value="dyslexic">OpenDyslexic (dyslexia-friendly)</option>' +
      '      <option value="atkinson">Atkinson Hyperlegible</option>' +
      '      <option value="serif">Serif (Source Serif)</option>' +
      '    </select>' +
      '  </div>' +
      '  <div class="a11y-fieldset"><legend>Spacing</legend>' +
      '    <div class="a11y-row"><label for="a11y-lh">Line spacing</label>' +
      '      <select id="a11y-lh"><option value="default">Default</option><option value="1.6">Roomy</option><option value="1.8">Extra roomy</option><option value="2">Double</option></select>' +
      '    </div>' +
      '    <div class="a11y-row"><label for="a11y-ls">Letter spacing</label>' +
      '      <select id="a11y-ls"><option value="default">Default</option><option value="0.04">A little more</option><option value="0.08">More</option><option value="0.12">Most</option></select>' +
      '    </div>' +
      '  </div>' +
      '  <fieldset class="a11y-fieldset"><legend>Color theme</legend>' +
      '    <div class="a11y-choices">' +
      '      <label><input type="radio" name="a11y-theme" value="default" checked> Default</label>' +
      '      <label><input type="radio" name="a11y-theme" value="hc-dark"> High contrast dark</label>' +
      '      <label><input type="radio" name="a11y-theme" value="hc-light"> High contrast light</label>' +
      '      <label><input type="radio" name="a11y-theme" value="cb-blue"> Colorblind-safe blue &amp; orange</label>' +
      '      <label><input type="radio" name="a11y-theme" value="cb-purple"> Colorblind-safe purple &amp; gold</label>' +
      '    </div>' +
      '  </fieldset>' +
      '  <fieldset class="a11y-fieldset"><legend>Custom colors</legend>' +
      '    <label style="display:flex;align-items:center;gap:8px;min-height:44px;font-weight:600"><input type="checkbox" id="a11y-custom-on"> Use my own colors</label>' +
      '    <div class="a11y-colors">' +
      '      <label>Text <input type="color" id="a11y-color-text" value="#1c2a2a"></label>' +
      '      <label>Background <input type="color" id="a11y-color-bg" value="#f7f8f6"></label>' +
      '      <label>Accent <input type="color" id="a11y-color-accent" value="#1f5e4f"></label>' +
      '    </div>' +
      '    <p class="a11y-contrast-warn" id="a11y-contrast-warn" role="status"></p>' +
      '  </fieldset>' +
      '  <fieldset class="a11y-fieldset"><legend>Motion</legend>' +
      '    <div class="a11y-choices">' +
      '      <label><input type="radio" name="a11y-motion" value="system" checked> Match my device</label>' +
      '      <label><input type="radio" name="a11y-motion" value="on"> Reduce motion</label>' +
      '      <label><input type="radio" name="a11y-motion" value="off"> Allow motion</label>' +
      '    </div>' +
      '  </fieldset>' +
      '  <div class="a11y-fieldset"><legend>Extra options</legend>' +
      '    <div class="switch-row"><span id="a11y-ul-lbl">Underline all links</span>' +
      '      <button type="button" class="cb-switch" id="a11y-underline" role="switch" aria-checked="false" aria-labelledby="a11y-ul-lbl"><span class="track" aria-hidden="true"></span></button>' +
      '    </div>' +
      '    <div class="switch-row"><span id="a11y-big-lbl">Bigger cursor and focus ring</span>' +
      '      <button type="button" class="cb-switch" id="a11y-bigcursor" role="switch" aria-checked="false" aria-labelledby="a11y-big-lbl"><span class="track" aria-hidden="true"></span></button>' +
      '    </div>' +
      '  </div>' +
      '  <button type="button" class="a11y-reset" id="a11y-reset">Reset to defaults</button>' +
      '</div>'
    );
  }

  function launchButtonHTML(extraClass) {
    // Octicons "accessibility" figure (MIT), the common accessibility symbol. The visible word is part of the name (WCAG 2.5.3).
    return '<button type="button" class="a11y-launch' + (extraClass ? " " + extraClass : "") + '" aria-haspopup="dialog" aria-controls="a11y-panel" aria-label="Accessibility settings">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M13.974 8.114a3.573 3.573 0 1 0-3.947 0c-.302.21-.57.467-.79.762H3.708a.75.75 0 1 0 0 1.5h4.885a2.93 2.93 0 0 0-.026.188l-.814 7.267-.499 4.142a.75.75 0 1 0 1.49.18l.42-3.486h5.67l.42 3.485a.75.75 0 0 0 1.49-.18l-.5-4.142-.813-7.266a3.502 3.502 0 0 0-.026-.188h4.885a.75.75 0 1 0 0-1.5h-5.527a3.466 3.466 0 0 0-.79-.762Zm.099-2.979a2.073 2.073 0 1 1-4.146 0 2.073 2.073 0 0 1 4.146 0Zm-.131 5.596.72 6.436H9.338l.72-6.436a1.954 1.954 0 0 1 3.884 0Z"></path></svg>' +
      '<span>Accessibility</span></button>';
  }

  function listenBarHTML(selector, label) {
    label = label || "Listen to this section";
    return '<div class="listen-bar" data-listen-for="' + selector + '">' +
      '<span class="listen-label">' + label + '</span>' +
      '<div class="listen-controls">' +
      '<button type="button" class="listen-btn" data-act="play" aria-label="Listen: play read-aloud">Listen</button>' +
      '<button type="button" class="listen-btn" data-act="pause" aria-label="Pause read-aloud" disabled>Pause</button>' +
      '<button type="button" class="listen-btn" data-act="stop" aria-label="Stop read-aloud" disabled>Stop</button>' +
      '<label class="listen-speed"><span>Speed</span> <select aria-label="Read-aloud speed">' +
      '<option value="0.75">0.75×</option><option value="1" selected>1×</option>' +
      '<option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>' +
      '</select></label>' +
      '</div><p class="listen-status" role="status" aria-live="polite"></p></div>';
  }

  window.CureBranchA11y = {
    apply: function () { apply(settings); },
    set: function (partial) { settings = Object.assign({}, settings, partial || {}); apply(settings); },
    getSettings: function () { return settings; },
    bestVoice: bestVoice,
    openPanel: openPanel,
    closePanel: closePanel,
    stopSpeech: stopSpeech,
    launchButtonHTML: launchButtonHTML,
    listenBarHTML: listenBarHTML,
    panelHTML: panelHTML,
    contrast: contrast,
    init: function () {
      /* Inject panel once */
      if (!val("a11y-panel")) {
        var wrap = document.createElement("div");
        wrap.innerHTML = panelHTML();
        while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
      }
      document.querySelectorAll("[data-listen-mount]").forEach(function (el) {
        if (el.getAttribute("data-mounted")) return;
        var sel = el.getAttribute("data-listen-mount");
        var label = el.getAttribute("data-listen-label") || "Listen to this section";
        el.innerHTML = listenBarHTML(sel, label);
        el.setAttribute("data-mounted", "1");
      });
      document.querySelectorAll("[data-a11y-launch]").forEach(function (el) {
        if (el.getAttribute("data-mounted")) return;
        el.innerHTML = launchButtonHTML(el.getAttribute("data-a11y-launch") || "");
        el.setAttribute("data-mounted", "1");
      });
      wirePanel();
      wireListenBars();
      apply(settings);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { window.CureBranchA11y.init(); });
  } else {
    window.CureBranchA11y.init();
  }
})();
