// Generates Maze-Bingo-Balancing.xlsx from balancing/rates.js.
//
//   node balancing/build-workbook.js
//
// Each task type gets a catalogue sheet holding one row per option the plugin can
// track, with an "hours per unit" column. A hidden LOOKUP sheet stacks every
// catalogue keyed by "<taskType>|<option>", and the PLANNER sheet resolves each
// tile's chosen options against it. Editing a rate on a catalogue sheet flows
// through to every planner row that uses it.

const path = require('path');
const ExcelJS = require('exceljs');
const { NPCS, ITEMS, SKILLS, COURSES, MINIGAMES, CLUES, GP_METHODS } = require('./rates');

// Pass a path to write elsewhere, e.g. when the real workbook is open in Excel.
const OUT = process.argv[2] || path.join(__dirname, '..', 'Maze-Bingo-Balancing.xlsx');
const PLANNER_ROWS = 81;

// --- shared styling -------------------------------------------------------
const INK = 'FF1F2933';
const HEADER_BG = 'FF2E3B4E';
const INPUT_BG = 'FFFFF6DC';
const CALC_BG = 'FFEFF4FB';
const HOURS_FMT = '0.00';
const CLOCK_FMT = '[h]:mm:ss';

function styleHeader(sheet, row = 1) {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
  r.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  r.height = 30;
  sheet.views = [{ state: 'frozen', ySplit: row }];
}

function tintColumn(sheet, colLetter, firstRow, lastRow, argb) {
  for (let r = firstRow; r <= lastRow; r++) {
    sheet.getCell(`${colLetter}${r}`).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb },
    };
  }
}

// Colours the ETC column so slow tasks stand out at a glance.
function etcScale(sheet, ref) {
  sheet.addConditionalFormatting({
    ref,
    rules: [{
      type: 'colorScale',
      cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
      color: [
        { argb: 'FFB7E4C7' }, // fast — green
        { argb: 'FFFFE8A3' }, // medium — amber
        { argb: 'FFF4A9A8' }, // slow — red
      ],
    }],
  });
}

const wb = new ExcelJS.Workbook();
wb.creator = 'Maze Bingo balancing';
wb.created = new Date(2026, 7, 13);

// Collected as sheets are built, then written to _map and used for defined names.
// The PLANNER resolves options by NAME rather than by row position, so sorting or
// filtering any catalogue cannot decouple an option from its rate.
const catalogueMeta = []; // { taskType, sheetName, hoursCol, unit }
const optionRanges = {}; // taskType -> "sheet!$A$2:$A$n"

// ---------------------------------------------------------------------------
// Generic catalogue sheet builder.
// `cols` describes everything except the trailing Qty / ETC / source block,
// which every catalogue shares.
// ---------------------------------------------------------------------------
function buildCatalogue({ taskType, sheetName, unit, nameHeader, cols, rows, hoursFormula, defaultQty }) {
  const sheet = wb.addWorksheet(sheetName, { properties: { defaultRowHeight: 18 } });

  const headers = [nameHeader, ...cols.map(c => c.header), 'Hours per 1 ' + unit, 'Qty', 'ETC (hours)', 'ETC', 'Source', 'Reference'];
  sheet.addRow(headers);

  // Column index of the "Hours per 1 <unit>" column, 1-based.
  const hoursCol = 2 + cols.length;
  const hoursL = colLetter(hoursCol);
  const qtyL = colLetter(hoursCol + 1);
  const etcHL = colLetter(hoursCol + 2);
  const etcCL = colLetter(hoursCol + 3);

  rows.forEach((row, i) => {
    const r = i + 2;
    const values = [row.name, ...cols.map(c => c.value(row))];
    values[hoursCol - 1] = { formula: hoursFormula(r) };
    values[hoursCol] = defaultQty;
    values[hoursCol + 1] = { formula: `${hoursL}${r}*${qtyL}${r}` };
    values[hoursCol + 2] = { formula: `${etcHL}${r}/24` };
    values[hoursCol + 3] = row.src;
    values[hoursCol + 4] = row.ref;
    sheet.addRow(values);
  });

  const last = rows.length + 1;
  sheet.getColumn(1).width = 30;
  cols.forEach((c, i) => { sheet.getColumn(2 + i).width = c.width || 14; });
  sheet.getColumn(hoursCol).width = 16;
  sheet.getColumn(hoursCol + 1).width = 10;
  sheet.getColumn(hoursCol + 2).width = 12;
  sheet.getColumn(hoursCol + 3).width = 12;
  sheet.getColumn(hoursCol + 4).width = 10;
  sheet.getColumn(hoursCol + 5).width = 60;

  sheet.getColumn(hoursCol).numFmt = '0.000000';
  sheet.getColumn(hoursCol + 2).numFmt = HOURS_FMT;
  sheet.getColumn(hoursCol + 3).numFmt = CLOCK_FMT;
  cols.forEach((c, i) => { if (c.numFmt) sheet.getColumn(2 + i).numFmt = c.numFmt; });

  tintColumn(sheet, qtyL, 2, last, INPUT_BG);
  tintColumn(sheet, hoursL, 2, last, CALC_BG);
  etcScale(sheet, `${etcHL}2:${etcHL}${last}`);

  styleHeader(sheet);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: headers.length } };

  optionRanges[taskType] = `${sheetName}!$A$2:$A$${last}`;
  catalogueMeta.push({ taskType, sheetName, hoursCol, unit });
  return sheet;
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------
const readme = wb.addWorksheet('README', { properties: { defaultRowHeight: 18 } });
readme.columns = [{ width: 22 }, { width: 118 }];
const readmeLines = [
  ['Maze Bingo — task balancing', ''],
  ['', ''],
  ['What this is', 'One catalogue sheet per task type your RuneLite plugin can track, plus a PLANNER sheet with one row per maze tile.'],
  ['', 'Every catalogue row states how long one unit takes for a maxed main in best-in-slot gear. Enter a Qty and the ETC column'],
  ['', 'shows the time cost. The PLANNER resolves multi-option tasks and both progress modes against those same numbers.'],
  ['', ''],
  ['How to use it', '1. Open PLANNER. Pick a task type per tile, then up to four options from the dropdowns.'],
  ['', '2. Set Mode to "any" or "each" — this must match taskConfig.mode in your save file.'],
  ['', '3. Set Target. This is taskConfig.target, so it means the same thing here as it does in the JSON.'],
  ['', '4. Read ETC. Sort the sheet by it to find the tiles that are out of line with their neighbours.'],
  ['', ''],
  ['Mode semantics', 'These mirror getEachModeItems in maze-api.js exactly.'],
  ['', 'any  — target is a pooled total across all listed options. The team funnels into whichever option is cheapest,'],
  ['', '       so ETC = target x the FASTEST option. The "Worst case" column shows target x the slowest option, which is'],
  ['', '       what you pay if the team picks badly or only has access to one of them.'],
  ['', 'each — target is per option, and each option is capped at target. completionsRequired becomes options x target,'],
  ['', '       so ETC = target x the SUM of every option. Adding a fifth NPC to an each-mode tile makes it strictly longer.'],
  ['', ''],
  ['Reading ETC', 'ETC is one-player hours. A tile at 6.0 hours takes one person a six-hour session, or roughly 1 hour for a'],
  ['', 'six-person team working it in parallel. Parallelism is not free: item_drop and clue tasks split cleanly across'],
  ['', 'players, but a single Nex team caps at how many bodies fit in the instance. Treat team-hours as a floor.'],
  ['', ''],
  ['Rate basis', 'Maxed main, best-in-slot. Where the wiki gives a range ("assumes 22 kills per hour, but up to 34 with maxed'],
  ['', 'stats"), the upper figure is used. If your roster is mostly mid-game, multiply the ETC column by about 1.5.'],
  ['', ''],
  ['Source column', 'wiki    — the number is stated verbatim on the referenced OSRS Wiki page.'],
  ['', 'derived — computed from wiki numbers, e.g. agility laps/hr is XP/hr divided by XP/lap.'],
  ['', 'est     — no wiki figure exists. Defensible, but these are the rows to sanity-check first.'],
  ['', ''],
  ['Sorting', 'Safe. Sort or filter any catalogue however you like — the PLANNER finds options by name, not by row number.'],
  ['', 'Use the filter arrows in the header row so whole rows move together. The one thing that WILL break things is'],
  ['', 'inserting or reordering COLUMNS on a catalogue sheet, because _map records which column holds the rate.'],
  ['', ''],
  ['Known caveats', 'Farming 2.5M XP/hr is per actively spent hour and is gated by real-world tree growth timers, not play time.'],
  ['', 'Ranged, Hunter and Runecraft top rates assume alt accounts. Override them if your ruleset forbids alts.'],
  ['', 'Hallowed Sepulchre floors all show 7/hr because one full floor-5 run fires one chat message per floor.'],
  ['', 'Clue rates are derived from wiki step counts at roughly 2 minutes per step; no wiki figure exists for clues/hr.'],
  ['', 'gp_value only counts NPC loot, since that is what the plugin sums. Skilling money makers do not contribute.'],
  ['', ''],
  ['Regenerating', 'Edit balancing/rates.js and run: node balancing/build-workbook.js'],
];
readmeLines.forEach(l => readme.addRow(l));
// Any row with a label in column A is a section heading.
readmeLines.forEach((l, i) => {
  if (i > 0 && l[0]) readme.getCell(`A${i + 1}`).font = { bold: true, color: { argb: HEADER_BG } };
});
readme.getRow(1).font = { bold: true, size: 16, color: { argb: INK } };

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------
buildCatalogue({
  taskType: 'npc_kill', sheetName: 'npc_kill', unit: 'kill', nameHeader: 'NPC',
  rows: NPCS.map(n => ({ ...n, name: n.name })),
  cols: [
    { header: 'Category', value: n => n.cat, width: 14 },
    { header: 'HP', value: n => n.hp, width: 10, numFmt: '#,##0' },
    { header: 'Kills / hr', value: n => n.kph, width: 12, numFmt: '0.##' },
    { header: 'Sec / kill', value: (n, r) => null, width: 12, numFmt: '0' },
  ],
  hoursFormula: r => `1/D${r}`,
  defaultQty: 50,
});
// Sec/kill needs a formula, which the generic builder cannot express inline.
{
  const s = wb.getWorksheet('npc_kill');
  for (let r = 2; r <= NPCS.length + 1; r++) s.getCell(`E${r}`).value = { formula: `3600/D${r}` };
}

buildCatalogue({
  taskType: 'npc_damage', sheetName: 'npc_damage', unit: 'damage', nameHeader: 'NPC',
  rows: NPCS.map(n => ({ ...n, name: n.name })),
  cols: [
    { header: 'Category', value: n => n.cat, width: 14 },
    { header: 'HP per kill', value: n => n.hp, width: 12, numFmt: '#,##0' },
    { header: 'Kills / hr', value: n => n.kph, width: 12, numFmt: '0.##' },
    { header: 'Damage / hr', value: () => null, width: 14, numFmt: '#,##0' },
  ],
  hoursFormula: r => `1/E${r}`,
  defaultQty: 50000,
});
{
  const s = wb.getWorksheet('npc_damage');
  for (let r = 2; r <= NPCS.length + 1; r++) s.getCell(`E${r}`).value = { formula: `C${r}*D${r}` };
}

buildCatalogue({
  taskType: 'xp_gain', sheetName: 'xp_gain', unit: 'XP', nameHeader: 'Skill',
  rows: SKILLS.map(s => ({ ...s, name: s.skill })),
  cols: [
    { header: 'XP / hr', value: s => s.xph, width: 14, numFmt: '#,##0' },
    { header: 'Method', value: s => s.method, width: 52 },
  ],
  hoursFormula: r => `1/B${r}`,
  defaultQty: 100000,
});

buildCatalogue({
  taskType: 'item_drop', sheetName: 'item_drop', unit: 'drop', nameHeader: 'Item',
  rows: ITEMS.map(i => ({ ...i, name: i.item })),
  cols: [
    { header: 'Source NPC', value: i => i.npc, width: 26 },
    { header: 'Drop rate (1 in N)', value: i => i.rate, width: 16, numFmt: '#,##0.#' },
    { header: 'Kills / hr', value: () => null, width: 12, numFmt: '0.##' },
    { header: 'Expected kills', value: () => null, width: 14, numFmt: '#,##0' },
  ],
  hoursFormula: r => `IFERROR(C${r}/D${r},"")`,
  defaultQty: 1,
});
{
  const s = wb.getWorksheet('item_drop');
  for (let r = 2; r <= ITEMS.length + 1; r++) {
    s.getCell(`D${r}`).value = { formula: `IFERROR(VLOOKUP(B${r},npc_kill!$A:$D,4,FALSE),"")` };
    s.getCell(`E${r}`).value = { formula: `C${r}` };
  }
}

buildCatalogue({
  taskType: 'agility_lap', sheetName: 'agility_lap', unit: 'lap', nameHeader: 'Course',
  rows: COURSES.map(c => ({ ...c, name: c.course })),
  cols: [
    { header: 'XP / lap', value: c => c.xpLap, width: 12, numFmt: '#,##0.#' },
    { header: 'XP / hr', value: c => c.xph, width: 12, numFmt: '#,##0' },
    { header: 'Laps / hr', value: c => c.lph, width: 12, numFmt: '0.#' },
    { header: 'Sec / lap', value: () => null, width: 12, numFmt: '0' },
  ],
  hoursFormula: r => `1/D${r}`,
  defaultQty: 100,
});
{
  const s = wb.getWorksheet('agility_lap');
  for (let r = 2; r <= COURSES.length + 1; r++) s.getCell(`E${r}`).value = { formula: `3600/D${r}` };
}

buildCatalogue({
  taskType: 'minigame_completion', sheetName: 'minigame', unit: 'completion', nameHeader: 'Minigame',
  rows: MINIGAMES.map(m => ({ ...m, name: m.minigame })),
  cols: [
    { header: 'Completions / hr', value: m => m.cph, width: 16, numFmt: '0.##' },
    { header: 'Chat message (taskConfig.message)', value: m => m.message, width: 44 },
  ],
  hoursFormula: r => `1/B${r}`,
  defaultQty: 25,
});

buildCatalogue({
  taskType: 'clue_completion', sheetName: 'clue', unit: 'clue', nameHeader: 'Tier',
  rows: CLUES.map(c => ({ ...c, name: c.tier })),
  cols: [
    { header: 'Clues / hr', value: c => c.cph, width: 12, numFmt: '0.##' },
    { header: 'Steps', value: c => c.steps, width: 10 },
    { header: 'Avg steps', value: c => c.avgSteps, width: 12, numFmt: '0.#' },
  ],
  hoursFormula: r => `1/B${r}`,
  defaultQty: 10,
});

buildCatalogue({
  taskType: 'gp_value', sheetName: 'gp_value', unit: 'GP', nameHeader: 'Method',
  rows: GP_METHODS.map(g => ({ ...g, name: g.method })),
  cols: [
    { header: 'GP / hr', value: g => g.gph, width: 16, numFmt: '#,##0' },
  ],
  hoursFormula: r => `1/B${r}`,
  defaultQty: 10000000,
});

// ---------------------------------------------------------------------------
// _map — tells the PLANNER which sheet and column hold the rate for a task type.
//
// The PLANNER looks options up BY NAME with VLOOKUP against the catalogue sheet,
// so sorting or filtering a catalogue is safe: VLOOKUP finds the row wherever it
// has moved to. Only the column layout is positional, and that is fixed by this
// generator. Do not insert or reorder COLUMNS on a catalogue sheet.
// ---------------------------------------------------------------------------
const map = wb.addWorksheet('_map', { state: 'hidden' });
map.addRow(['Task type', 'Sheet', 'Hours column index', 'Unit']);
catalogueMeta.forEach(m => map.addRow([m.taskType, m.sheetName, m.hoursCol, m.unit]));
map.getColumn(1).width = 24;
map.getColumn(2).width = 18;
styleHeader(map);

// Duplicate option names within one catalogue would make VLOOKUP silently pick
// the first match, so fail the build loudly rather than ship an ambiguous sheet.
const dupCheck = [
  ['npc_kill/npc_damage', NPCS.map(n => n.name)],
  ['item_drop', ITEMS.map(i => i.item)],
  ['xp_gain', SKILLS.map(s => s.skill)],
  ['agility_lap', COURSES.map(c => c.course)],
  ['minigame_completion', MINIGAMES.map(m => m.minigame)],
  ['clue_completion', CLUES.map(c => c.tier)],
  ['gp_value', GP_METHODS.map(g => g.method)],
];
let dupFound = false;
dupCheck.forEach(([label, names]) => {
  const d = [...new Set(names.filter((v, i, a) => a.indexOf(v) !== i))];
  if (d.length) { console.error(`ERROR duplicate option names in ${label}: ${d.join(', ')}`); dupFound = true; }
});
if (dupFound) process.exit(1);

// ---------------------------------------------------------------------------
// PLANNER
// ---------------------------------------------------------------------------
const TASK_TYPES = ['npc_kill', 'npc_damage', 'xp_gain', 'item_drop', 'agility_lap', 'minigame_completion', 'clue_completion', 'gp_value'];
const EACH_CAPABLE = ['npc_kill', 'npc_damage', 'xp_gain', 'item_drop', 'agility_lap', 'clue_completion'];

const planner = wb.addWorksheet('PLANNER', { properties: { defaultRowHeight: 18 } });
planner.addRow([
  'Tile', 'Task type', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Mode', 'Target',
  'ETC (hours)', 'ETC', 'Worst case (hrs)', 'Unit', 'Team hours',
  'h1', 'h2', 'h3', 'h4', 'Notes',
]);

const SIZE = 9;
const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1; // bottom-centre
const endId = Math.floor(SIZE / 2) + 1;                        // top-centre

// Resolves one option cell to its hours-per-unit by NAME. The sheet to search and
// the column to return both come from _map, keyed on the row's task type, so this
// survives any sort or filter applied to a catalogue.
const rateFor = (r, optCol) =>
  `IF(OR($B${r}="",${optCol}${r}=""),"",IFERROR(VLOOKUP(${optCol}${r},` +
  `INDIRECT("'"&VLOOKUP($B${r},_map!$A:$D,2,FALSE)&"'!$A:$Z"),` +
  `VLOOKUP($B${r},_map!$A:$D,3,FALSE),FALSE),""))`;

for (let tile = 1; tile <= PLANNER_ROWS; tile++) {
  const r = tile + 1;
  const note = tile === startId ? 'START' : tile === endId ? 'END — must be a leaf tile' : '';
  planner.addRow([
    tile, null, null, null, null, null, null, null,
    { formula: `IF(OR($B${r}="",$H${r}="",COUNT($N${r}:$Q${r})=0),"",IF($G${r}="each",$H${r}*SUM($N${r}:$Q${r}),$H${r}*MIN($N${r}:$Q${r})))` },
    { formula: `IF($I${r}="","",$I${r}/24)` },
    { formula: `IF(OR($B${r}="",$H${r}="",$G${r}="each",COUNT($N${r}:$Q${r})=0),"",$H${r}*MAX($N${r}:$Q${r}))` },
    { formula: `IFERROR(VLOOKUP($B${r},_map!$A:$D,4,FALSE),"")` },
    { formula: `IF($I${r}="","",$I${r}/MAX(1,$U$3))` },
    { formula: rateFor(r, 'C') },
    { formula: rateFor(r, 'D') },
    { formula: rateFor(r, 'E') },
    { formula: rateFor(r, 'F') },
    note,
  ]);
}

const lastRow = PLANNER_ROWS + 1;
planner.getColumn('A').width = 7;
planner.getColumn('B').width = 21;
['C', 'D', 'E', 'F'].forEach(c => { planner.getColumn(c).width = 24; });
planner.getColumn('G').width = 8;
planner.getColumn('H').width = 13;
planner.getColumn('I').width = 12;
planner.getColumn('J').width = 11;
planner.getColumn('K').width = 15;
planner.getColumn('L').width = 12;
planner.getColumn('M').width = 12;
['N', 'O', 'P', 'Q'].forEach(c => { planner.getColumn(c).width = 9; planner.getColumn(c).hidden = true; });
planner.getColumn('R').width = 28;

planner.getColumn('H').numFmt = '#,##0';
planner.getColumn('I').numFmt = HOURS_FMT;
planner.getColumn('J').numFmt = CLOCK_FMT;
planner.getColumn('K').numFmt = HOURS_FMT;
planner.getColumn('M').numFmt = HOURS_FMT;

['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(c => tintColumn(planner, c, 2, lastRow, INPUT_BG));
etcScale(planner, `I2:I${lastRow}`);

// Dropdowns. Option columns key off the task type in column B via INDIRECT,
// so the list narrows to that type's catalogue.
// Columns B and G take one validation across the whole range. Assigning them
// per-cell makes exceljs emit overlapping sqrefs, which Excel treats as a repair.
planner.dataValidations.add(`B2:B${lastRow}`, {
  type: 'list', allowBlank: true, formulae: ['=tasktypes'],
  showErrorMessage: true, errorTitle: 'Unknown task type',
  error: 'Pick one of the eight task types the plugin supports.',
});
planner.dataValidations.add(`G2:G${lastRow}`, {
  type: 'list', allowBlank: true, formulae: ['"any,each"'],
  showErrorMessage: true, errorTitle: 'Mode',
  error: 'Use "any" for a pooled target, or "each" for a per-option target.',
});
// The option columns stay per-row: each INDIRECT is relative to that row's type.
for (let r = 2; r <= lastRow; r++) {
  planner.dataValidations.add(`C${r}:F${r}`, {
    type: 'list', allowBlank: true, formulae: [`=INDIRECT("opt_"&$B${r})`],
    showErrorMessage: false,
  });
}

// Summary block to the right.
planner.getCell('T2').value = 'Summary';
planner.getCell('T2').font = { bold: true, size: 13, color: { argb: INK } };
const summary = [
  ['Team size', 6, 'Used for the Team hours column.'],
  ['Tiles with a task', { formula: `COUNTIF(B2:B${lastRow},"?*")` }, ''],
  ['Total ETC (hours)', { formula: `SUM(I2:I${lastRow})` }, 'One-player hours across the whole maze.'],
  ['Total team hours', { formula: `SUM(M2:M${lastRow})` }, 'Floor only — parallelism is capped per activity.'],
  ['Mean tile ETC', { formula: `IFERROR(AVERAGE(I2:I${lastRow}),0)` }, ''],
  ['Median tile ETC', { formula: `IFERROR(MEDIAN(I2:I${lastRow}),0)` }, ''],
  ['Fastest tile', { formula: `IFERROR(MIN(I2:I${lastRow}),0)` }, ''],
  ['Slowest tile', { formula: `IFERROR(MAX(I2:I${lastRow}),0)` }, ''],
  ['Spread (max/min)', { formula: `IFERROR(MAX(I2:I${lastRow})/MIN(I2:I${lastRow}),0)` }, 'Under about 5x reads as evenly balanced.'],
];
summary.forEach((row, i) => {
  const r = i + 3;
  planner.getCell(`T${r}`).value = row[0];
  planner.getCell(`U${r}`).value = row[1];
  planner.getCell(`V${r}`).value = row[2];
  planner.getCell(`T${r}`).font = { bold: true };
  planner.getCell(`U${r}`).numFmt = HOURS_FMT;
});
planner.getCell('U3').numFmt = '0';
planner.getCell('U4').numFmt = '0';
planner.getCell('U3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } };
planner.getColumn('T').width = 20;
planner.getColumn('U').width = 12;
planner.getColumn('V').width = 48;

planner.getCell('T14').value = 'Mode reminder';
planner.getCell('T14').font = { bold: true, color: { argb: HEADER_BG } };
[
  'any  — target is pooled. ETC uses the FASTEST option; Worst case uses the slowest.',
  'each — target is per option. ETC is target x the SUM of all options.',
  `each is only supported for: ${EACH_CAPABLE.join(', ')}.`,
].forEach((t, i) => { planner.getCell(`T${15 + i}`).value = t; });

styleHeader(planner);
planner.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
planner.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: 18 } };

// ---------------------------------------------------------------------------
// Defined names — drive the dropdowns.
// ---------------------------------------------------------------------------
const typesSheet = wb.addWorksheet('_types', { state: 'hidden' });
TASK_TYPES.forEach((t, i) => { typesSheet.getCell(`A${i + 1}`).value = t; });
wb.definedNames.add(`_types!$A$1:$A$${TASK_TYPES.length}`, 'tasktypes');
Object.entries(optionRanges).forEach(([taskType, ref]) => {
  wb.definedNames.add(ref, `opt_${taskType}`);
});

wb.xlsx.writeFile(OUT).then(() => {
  console.log(`Wrote ${OUT}`);
  console.log(`  npc_kill / npc_damage : ${NPCS.length} NPCs`);
  console.log(`  item_drop             : ${ITEMS.length} items`);
  console.log(`  xp_gain               : ${SKILLS.length} skills`);
  console.log(`  agility_lap           : ${COURSES.length} courses`);
  console.log(`  minigame_completion   : ${MINIGAMES.length} minigames`);
  console.log(`  clue_completion       : ${CLUES.length} tiers`);
  console.log(`  gp_value              : ${GP_METHODS.length} methods`);
  console.log(`  lookups resolve by name — catalogues are safe to sort`);
});
