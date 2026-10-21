/** Style sheets of the exported files. They set the paper the way the reader does, without scripts or interactivity. */
import type { PaperLayout, PaperTheme } from './paperShared';

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  card: string;
  border: string;
}

const PALETTES: Record<PaperTheme, Palette> = {
  paper: { bg: '#fbfaf7', fg: '#1c1b19', muted: '#6b675f', accent: '#2457d6', card: '#f1efe9', border: '#dcd8cd' },
  sepia: { bg: '#f4ecd8', fg: '#433422', muted: '#7a6a55', accent: '#8a4b12', card: '#ebe0c6', border: '#d6c7a4' },
  dark: { bg: '#17181b', fg: '#d6d6d9', muted: '#8f9096', accent: '#8ab4ff', card: '#222429', border: '#34363c' },
  black: { bg: '#000', fg: '#c9c9cc', muted: '#7d7e83', accent: '#8ab4ff', card: '#121316', border: '#26282d' },
};

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Rules shared by both targets. Colours are literal so old reading systems that lack CSS variables still render it. */
function rules(p: Palette, layout: PaperLayout, epub: boolean): string {
  const mag = layout === 'magazine';
  const muted = epub ? 'opacity:.72' : `color:${p.muted}`;
  const border = epub ? 'currentColor' : p.border;
  const accent = epub ? 'currentColor' : p.accent;
  const card = epub ? 'rgba(127,127,127,.12)' : p.card;
  return `
.title{font-size:${mag ? '2.3em' : '1.5em'};line-height:${mag ? '1.05' : '1.25'};font-weight:${mag ? '800' : '700'};${mag ? 'letter-spacing:-.025em;' : ''}margin:${mag ? '.7em 0 .35em' : '1em 0 .45em'}}
.authors{${muted};font-size:.88em;line-height:1.4;margin:0 0 .25em;${mag ? `font-family:${SANS};font-weight:600;text-transform:uppercase;letter-spacing:.1em;font-size:.68em;` : ''}}
p{margin:0 0 .85em}
.blk-paragraph .px{font-weight:700}
.abstract{${mag ? `font-size:1.12em;line-height:1.5;font-style:italic;border-left:4px solid ${accent};padding-left:1em;margin:1.1em 0 1.5em;` : `margin:1.1em 0 1.4em;`}}
.abstract .px{${mag ? `font-style:normal;font-family:${SANS};text-transform:uppercase;letter-spacing:.1em;font-size:.66em;` : ''}}
.h{font-weight:700;line-height:1.3;text-wrap:balance;${mag ? `font-family:${SANS};` : ''}page-break-after:avoid;break-after:avoid}
h2.h{font-size:${mag ? '.74em' : '1.25em'};margin:${mag ? '2.4em 0 1em' : '1.5em 0 .55em'};${mag ? `text-transform:uppercase;letter-spacing:.14em;border-top:3px solid ${accent};padding-top:.6em;` : ''}}
h3.h{font-size:${mag ? '1.04em' : '1.1em'};margin:1.4em 0 .5em}
h4.h{font-size:1em;font-style:italic;margin:1.2em 0 .4em}
.h .hn{${muted};font-weight:600;margin-right:.45em}
ul.list{list-style:none;margin:0 0 .85em;padding:0}
ul.list li{display:flex;gap:.7em;margin:0 0 .4em .4em}
ul.list .mk{flex:none;min-width:1.1em;${muted}}
ul.list .lt{flex:1;min-width:0}
a.cite{${epub ? '' : `color:${p.accent};`}text-decoration:none}
a.link{${epub ? '' : `color:${p.accent};`}}
.m{font-family:'STIX Two Math','Cambria Math','Times New Roman',serif;font-style:italic}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82em}
pre{background:${card};border:1px solid ${border};border-radius:8px;padding:10px 12px;overflow-x:auto;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
figure{margin:1.1em 0}
figure img,.eq img{display:block;max-width:100%;height:auto;margin:0 auto;background:#fff}
figcaption,.cap{font-size:.82em;line-height:1.45;${muted};margin-top:.5em}
${mag ? `figcaption{font-family:${SANS};font-weight:600;font-size:.72em;border-top:2px solid currentColor;padding-top:.45em;opacity:1}` : ''}
.tbl figcaption{margin:0 0 .5em}
.tblwrap{overflow-x:auto;border:1px solid ${border};border-radius:8px}
table{border-collapse:collapse;font-size:.8em;line-height:1.35;min-width:100%}
th,td{padding:5px 9px;text-align:left;border-bottom:1px solid ${border}}
th{font-weight:700;background:${card}}
td.num{text-align:right}
.eq{display:flex;align-items:center;gap:10px;margin:1em 0}
.eq .eqbody{flex:1;min-width:0;text-align:center;overflow-x:auto}
.eq .eqt{font-family:'STIX Two Math','Cambria Math','Times New Roman',serif;font-style:italic}
.eqn{flex:none;${muted};font-size:.9em}.eqn::before{content:attr(data-n)}
.fn{font-size:.78em;line-height:1.45;${muted};border-top:1px solid ${border};padding-top:.5em;margin-top:1.2em}
.fn .fnm{font-weight:700;margin-right:.35em}
.ref{display:flex;gap:.6em;font-size:.82em;line-height:1.45;margin:0 0 .55em}
.ref .rl{flex:none;min-width:2.2em;${muted}}.ref .rt{flex:1;min-width:0}
details.figtext{margin:.35em 0 .2em;font-family:${SANS};font-size:.75em;${muted}}
details.figtext summary{padding:.2em 0}
details.figtext pre{font-family:${SANS};font-size:1em;background:none;border:0;padding:0;margin:.3em 0;${epub ? '' : `color:${p.fg};`}}
.pgb{height:0;overflow:visible;position:relative;margin:0}
.pgb::before{content:attr(data-label);position:absolute;right:0;top:-.9em;font:600 10px ${SANS};letter-spacing:.06em;text-transform:uppercase;${muted}}
.removed{margin-top:3em;border-top:1px solid ${border};padding-top:1em;font-size:.85em}
.removed h2{font-size:1.1em;margin:0 0 .4em}
.removed .rm{margin:0 0 .3em;${muted}}
.removed .rm::before{content:attr(data-label) '  ';font-weight:700}
`;
}

/** The standalone HTML file: colours from the chosen theme, columns for the magazine layout, a print sheet. */
export function htmlCss(theme: PaperTheme, layout: PaperLayout, font: 'serif' | 'sans'): string {
  const p = PALETTES[theme];
  const mag = layout === 'magazine';
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${p.bg};color:${p.fg}}
body{font-family:${font === 'sans' ? SANS : SERIF};font-size:18px;line-height:1.6;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
main{max-width:${mag ? '64em' : '46em'};margin:0 auto;padding:22px 22px 80px}
${rules(p, layout, false)}
${theme === 'dark' || theme === 'black' ? '.eq img{filter:none}' : ''}
${mag ? `.title,.authors,.abstract,.fig,.tbl,.eq,.removed,h2.h{column-span:all}
.lead::first-letter{float:left;font-size:3.5em;font-weight:800;line-height:.8;padding:.07em .1em 0 0;color:${p.accent}}
p,ul.list li{orphans:3;widows:3}
@media (min-width:700px){main{column-count:2;column-gap:2.4em;column-rule:1px solid ${p.border}}}` : ''}
@media print{
  html,body{background:#fff;color:#000}
  main{max-width:none;padding:0}
  figure,.eq,pre,.fn,tr{break-inside:avoid}
  .pgb{display:none}
  a{color:inherit}
}
`;
}

/** The EPUB style sheet: nothing that decides colour, font size or font of the body; the reading app keeps those. */
export function epubCss(layout: PaperLayout): string {
  const mag = layout === 'magazine';
  return `
body{margin:0;padding:0 .2em;line-height:1.5}
${rules(PALETTES.paper, layout, true)}
${mag ? `.lead::first-letter{float:left;font-size:3.2em;font-weight:800;line-height:.8;padding:.07em .1em 0 0}` : ''}
`;
}
