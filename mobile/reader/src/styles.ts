export const CSS = `
:root{
  --bg:#fbfaf7;--fg:#1c1b19;--muted:#6b675f;--accent:#2457d6;--card:#f1efe9;--border:#dcd8cd;
  --mark:#ffe58a;--warn:#b45309;--warnbg:#fff4e0;--fs:18px;--lh:1.6;--pad:22px;--k:1.8;
  --font:Georgia,'Times New Roman',serif;--sans:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
body.t-sepia{--bg:#f4ecd8;--fg:#433422;--muted:#7a6a55;--accent:#8a4b12;--card:#ebe0c6;--border:#d6c7a4;--warnbg:#f7e6c3}
body.t-dark{--bg:#17181b;--fg:#d6d6d9;--muted:#8f9096;--accent:#8ab4ff;--card:#222429;--border:#34363c;--warn:#f0a35e;--warnbg:#2c241a;--mark:#6b5a12}
body.t-black{--bg:#000;--fg:#c9c9cc;--muted:#7d7e83;--accent:#8ab4ff;--card:#121316;--border:#26282d;--warn:#f0a35e;--warnbg:#1d1710;--mark:#5a4b0e}
body.m-narrow{--pad:12px}body.m-normal{--pad:22px}body.m-wide{--pad:38px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg)}
body{font-family:var(--font);font-size:var(--fs);line-height:var(--lh);-webkit-text-size-adjust:100%;
  padding-top:env(safe-area-inset-top);padding-bottom:calc(env(safe-area-inset-bottom) + 120px);overflow-wrap:anywhere}
body.sans{--font:var(--sans)}
body.justify .blk-paragraph,body.justify .li .lt,body.justify .fn,body.justify .ref .rt{text-align:justify;hyphens:auto;-webkit-hyphens:auto}
#book{max-width:46em;margin:0 auto;padding:10px var(--pad) 40px}
.blk{position:relative;margin:0 0 .85em;scroll-margin-top:10px;border-radius:4px}
.blk.sel{background:var(--card);box-shadow:0 0 0 6px var(--card);background:color-mix(in srgb,var(--accent) 10%,transparent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 10%,transparent)}
.blk.flash{animation:flash 1.8s ease-out}
@keyframes flash{0%,40%{background:var(--mark)}100%{background:transparent}}
.blk.bm::before{content:'';position:absolute;left:calc(var(--pad) * -0.62);top:.1em;width:9px;height:20px;background:var(--accent);
  clip-path:polygon(0 0,100% 0,100% 100%,50% 76%,0 100%)}
.title{font-size:1.5em;line-height:1.25;font-weight:700;margin:1em 0 .45em;text-wrap:balance}
.authors{color:var(--muted);font-size:.88em;line-height:1.4;margin:0 0 .25em}
.h{font-weight:700;line-height:1.3;margin:1.5em 0 .55em;text-wrap:balance}
h2.h{font-size:1.25em}h3.h{font-size:1.1em}h4.h{font-size:1em;font-style:italic}
.h .hn{color:var(--muted);font-weight:600;margin-right:.45em;font-variant-numeric:tabular-nums}
.qc{display:flex;align-items:center;gap:12px;margin:1.8em 0 1.2em;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--card);font-family:var(--sans)}
.qc .qct{flex:1;display:flex;flex-direction:column;gap:2px;font-size:14px;line-height:1.35}.qc small{color:var(--muted);font-size:12px}
.qc button{font:600 13px var(--sans);color:var(--bg);background:var(--accent);border:0;border-radius:999px;padding:8px 16px}
.pgsep{display:flex;align-items:center;gap:8px;font:600 11px/1 var(--sans);color:var(--muted);letter-spacing:.04em;margin:1.4em 0 .8em;
  text-transform:uppercase;cursor:pointer;user-select:none}
.pgsep::before,.pgsep::after{content:'';flex:1;height:1px;background:var(--border)}
.li{display:flex;gap:.7em;margin-left:.4em}.li .mk{flex:none;min-width:1.1em;color:var(--muted)}.li .lt{flex:1;min-width:0}
.blk[data-label]::before{content:attr(data-label);display:block;font:700 .66em var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.4em}
a.cite{color:var(--accent);text-decoration:none;border-radius:3px;padding:0 1px}
a.link{color:var(--accent)}
.m{font-family:'STIX Two Math','Cambria Math','Times New Roman',serif;font-style:italic}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82em}
pre{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;overflow-x:auto;line-height:1.45;white-space:pre}
mark.hl{color:inherit;border-radius:2px;padding:0}
mark.hl.note{border-bottom:2px solid var(--accent)}
.fig,.tbl{margin:1.1em 0}
.imgwrap{position:relative;border-radius:8px;overflow:hidden;background:#fff;border:1px solid var(--border);cursor:zoom-in}
.imgwrap img{display:block;width:100%;height:auto}
.imgwrap.loading::after{content:attr(data-loading);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font:12px var(--sans);color:#888}
figcaption,.cap{font-size:.82em;line-height:1.45;color:var(--muted);margin-top:.5em}
.tbl figcaption{margin:0 0 .5em}
.tbl .tbar{display:flex;gap:6px;margin:.4em 0;font:12px var(--sans)}
.tbl button{font:inherit;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:999px;padding:4px 10px}
.tbl button.on{color:var(--bg);background:var(--fg);border-color:var(--fg)}
.tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;font-size:.8em;line-height:1.35;min-width:100%}
th,td{padding:5px 9px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
th{font-weight:700;background:var(--card)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.eq{display:flex;align-items:center;gap:10px;margin:1em 0}
.eqscroll{flex:1;min-width:0;overflow-x:auto;display:flex;justify-content:center;cursor:zoom-in}
.eqscroll img{display:block;height:auto;max-width:100%;flex:none}
body.t-dark .tint,body.t-black .tint{filter:invert(1)}
.eqn{flex:none;color:var(--muted);font-size:.9em;font-variant-numeric:tabular-nums}
.fn{font-size:.78em;line-height:1.45;color:var(--muted);border-top:1px solid var(--border);padding-top:.5em;margin-top:1.2em}
.fn .fnm{font-weight:700;margin-right:.35em}
.ref{display:flex;gap:.6em;font-size:.82em;line-height:1.45;margin:0 0 .55em}
.ref .rl{flex:none;min-width:2.2em;color:var(--muted)}.ref .rt{flex:1;min-width:0}
.warn{border-left:3px solid var(--warn);padding-left:10px}
.note-info{border-left:3px dashed var(--border);padding-left:10px}
.flagdot{position:absolute;right:0;top:-.15em;width:22px;height:22px;border-radius:50%;border:0;background:var(--warn);color:#fff;
  font:700 12px/22px var(--sans);text-align:center;padding:0}
.flagdot.info{background:var(--muted)}
.figtext{margin:.35em 0 .2em;font:12px var(--sans);color:var(--muted)}.figtext summary{cursor:pointer;padding:.2em 0}.figtext-body{white-space:pre-wrap;margin:.3em 0;font:12px/1.45 var(--sans);color:var(--text);user-select:text;-webkit-user-select:text;overflow-wrap:anywhere}
.chip{display:inline-block;font:11px/1.2 var(--sans);color:var(--warn);background:var(--warnbg);border-radius:999px;padding:3px 8px;margin-top:6px}
.unsupported{margin:3em 0;padding:18px;border-radius:12px;background:var(--warnbg);color:var(--warn);font:15px/1.5 var(--sans)}
#orig{display:none;padding:6px 0 40px}
body.original #book{display:none}
body.original #orig{display:block}
.pg{position:relative;margin:10px auto;max-width:960px;background:#fff;box-shadow:0 1px 8px rgba(0,0,0,.28)}
.pg img{display:block;width:100%;height:auto;background:#fff}
.pg .pgno{position:absolute;left:8px;top:6px;font:600 11px var(--sans);color:#666;background:rgba(255,255,255,.85);padding:2px 6px;border-radius:999px}
.pg .hl{position:absolute;pointer-events:none;background:rgba(255,190,0,.28);outline:2px solid rgba(240,150,0,.95);border-radius:2px}
.pg .hover{position:absolute;pointer-events:none;background:rgba(36,87,214,.14);outline:1px solid rgba(36,87,214,.8)}
.pg.loading{min-height:200px}
.zoom{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.94);overflow:auto;-webkit-overflow-scrolling:touch}
.zoom img{display:block;max-width:none;background:#fff;margin:56px auto 40px}
.zoom img.tint{background:transparent;filter:invert(1)}
.zoom button{position:fixed;right:12px;top:calc(env(safe-area-inset-top) + 10px);z-index:51;font:700 16px var(--sans);width:40px;height:40px;
  border-radius:50%;border:0;color:#111;background:#fff}
.sheet{position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:40;background:var(--card);color:var(--fg);
  border:1px solid var(--border);border-radius:14px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.28);font:14px/1.45 var(--sans);
  max-height:46vh;overflow:auto}
.sheet .ref{font-size:13px;margin:0 0 8px}
.sheet .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
.sheet button{font:600 13px var(--sans);color:var(--accent);background:transparent;border:0;padding:6px 8px}
.pill{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 14px);z-index:30;border:0;border-radius:999px;
  padding:10px 16px;font:600 13px var(--sans);color:#fff;background:#1d2433;box-shadow:0 4px 16px rgba(0,0,0,.35)}
`;
