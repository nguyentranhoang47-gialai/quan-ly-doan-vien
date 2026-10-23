/**
 * gas-mock.js — Giả lập tối thiểu các dịch vụ Google Apps Script để chạy kiểm thử nghiệp vụ bằng Node.js.
 *
 * GIỚI HẠN: đây là mô phỏng hành vi (logic), KHÔNG đo được độ trễ thật của Google Sheets/Drive/Gmail,
 * không mô phỏng HTML Service, hạn mức (quota) hay khóa đồng thời giữa nhiều tiến trình.
 *
 * Mô phỏng các điểm quan trọng của Sheets:
 *  - setValues: chuỗi bắt đầu bằng "'" được lưu dạng văn bản (bỏ dấu ');
 *    chuỗi bắt đầu bằng "=" bị coi là CÔNG THỨC (đánh dấu để kiểm thử phát hiện chèn công thức);
 *    chuỗi trông giống số (vd "0912") trong ô không định dạng văn bản sẽ bị chuyển thành số (mất số 0 đầu).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let idSeq = 0;
const SPREADSHEETS = {};
const FOLDERS = {};

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const cell = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(cell === undefined || cell === null ? '' : (cell && cell.formula ? '#FORMULA' : cell));
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(l => l.length !== this.nc)) throw new Error('setValues: kích thước không khớp');
    this.sheet.writes++;
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.writes++; this.sheet.set(this.row, this.col, v); return this; }
  clearContent() {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) {
      const line = this.sheet.data[this.row - 1 + r]; if (line) line[this.col - 1 + c] = '';
    }
    this.sheet.trim(); return this;
  }
  setNumberFormat(f) { if (f === '@') for (let c = 0; c < this.nc; c++) this.sheet.textCols.add(this.col + c); return this; }
  setNotes() { return this; } setFontWeight() { return this; } setBackground() { return this; } setWrap() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.textCols = new Set(); this.prot = []; this.writes = 0; this.reads = 0; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.name; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const line = this.data[r - 1];
    while (line.length < c) line.push('');
    if (typeof v === 'string') {
      if (v.startsWith("'")) v = v.substring(1);                       // tiền tố ' → văn bản
      else if (v.startsWith('=')) v = { formula: v };                    // bị hiểu là công thức!
      else if (!this.textCols.has(c) && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v); // tự đổi sang số
    }
    line[c - 1] = v;
  }
  trim() { while (this.data.length && this.data[this.data.length - 1].every(v => v === '' || v === undefined)) this.data.pop(); }
  getLastRow() { this.trim(); return this.data.length; }
  getLastColumn() { return this.data.reduce((m, l) => { let n = l.length; while (n && (l[n - 1] === '' || l[n - 1] === undefined)) n--; return Math.max(m, n); }, 0); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  insertColumnsAfter(after, n) { this.maxCols += n; return this; }
  getRange(r, c, nr, nc) {
    // Như Google Sheets: vùng vượt kích thước sheet gây lỗi
    if (r + (nr || 1) - 1 > this.maxRows || c + (nc || 1) - 1 > this.maxCols) throw new Error('Phạm vi vượt kích thước sheet (' + this.name + ')');
    this.reads++; return new Range(this, r, c, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(line) { this.writes++; const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; line.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows() { return this; }
  getProtections() { return this.prot; }
  protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; } }; this.prot.push(p); return p; }
  clone() { const s = new Sheet(this.name); s.data = JSON.parse(JSON.stringify(this.data)); s.textCols = new Set(this.textCols); s.maxRows = this.maxRows; s.maxCols = this.maxCols; return s; }
  clearContents() { this.data = []; return this; }
}

class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = []; SPREADSHEETS[id] = this; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n, idx) { const s = new Sheet(n); if (idx === 0) this.sheets.unshift(s); else this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
}

function makeFile(id, name, parent) {
  const f = {
    id, name, trashed: false, created: new Date(Date.now() + (idSeq++)), parents: parent ? [parent] : [], desc: '',
    getId: () => id, getName: () => f.name, getDateCreated: () => f.created, setTrashed: v => { f.trashed = v; },
    setDescription: d => { f.desc = d; return f; },
    getParents: () => iter(f.parents),
    makeCopy(newName, folder) {
      const src = SPREADSHEETS[id];
      const nid = 'SS' + (++idSeq);
      const ss = new Spreadsheet(nid, newName);
      ss.sheets = src.sheets.map(s => s.clone());
      const nf = makeFile(nid, newName, folder);
      folder.files.push(nf);
      FILES[nid] = nf;
      return nf;
    }
  };
  return f;
}
const FILES = {};
function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
function makeFolder(name) {
  const id = 'FD' + (++idSeq);
  const f = { id, name, files: [], getId: () => id, getFiles: () => iter(f.files.filter(x => !x.trashed)) };
  FOLDERS[id] = f; return f;
}

function pad(n, l = 2) { return String(n).padStart(l, '0'); }
function formatDate(date, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
  const g = t => parts.find(p => p.type === t).value;
  const map = { yyyy: g('year'), MM: g('month'), dd: g('day'), HH: g('hour') === '24' ? '00' : g('hour'), mm: g('minute'), ss: g('second') };
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => lit !== undefined ? lit : map[m]);
}

function createEnv(opts = {}) {
  const ss = new Spreadsheet('SS-MAIN', 'Main');
  FILES['SS-MAIN'] = makeFile('SS-MAIN', 'Main', null);
  const props = {};
  const cache = {};
  const outbox = [];
  const state = { activeUser: 'owner@example.test', effectiveUser: 'owner@example.test', quota: 100, clockOffsetMs: 0, mailFail: false };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + state.clockOffsetMs); }
    static now() { return RealDate.now() + state.clockOffsetMs; }
  }
  const sandbox = {
    console: { log() {}, error: (...a) => { if (opts.verbose) console.error(...a); } },
    Date: FakeDate,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: id => { if (!SPREADSHEETS[id]) throw new Error('not found'); return SPREADSHEETS[id]; },
      ProtectionType: { SHEET: 'SHEET' }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }
    }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    MailApp: {
      getRemainingDailyQuota: () => state.quota,
      sendEmail: m => { if (state.mailFail) throw new Error('Mail error'); state.quota--; outbox.push(m); }
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.activeUser }),
      getEffectiveUser: () => ({ getEmail: () => state.effectiveUser })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => formatDate(d, tz, f),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b))
    },
    DriveApp: {
      getFileById: id => { if (!FILES[id]) throw new Error('no file'); return FILES[id]; },
      createFolder: name => makeFolder(name),
      getFolderById: id => { if (!FOLDERS[id]) throw new Error('no folder'); return FOLDERS[id]; }
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ inTimezone: () => ({ create() {} }) }) }) }) }) },
    HtmlService: {}
  };
  vm.createContext(sandbox);
  const dir = opts.dir || path.join(__dirname, '..', 'apps-script');
  // Nạp theo thứ tự chữ cái (Config.gs KHÔNG đứng đầu) để chắc chắn mã không phụ thuộc thứ tự nạp tệp.
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
  });
  return { ctx: sandbox, ss, props, cache, outbox, state, run: code => vm.runInContext(code, sandbox) };
}

module.exports = { createEnv, SPREADSHEETS, FILES, FOLDERS };
