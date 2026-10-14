/*
 * The collector's journal: an append-only file of accepted readings, kept on
 * the collector's disk until the database has them.
 *
 * Why it exists. The broker forgets a QoS 1 message the moment the collector
 * acknowledges it, and the collector acknowledges on receipt. Readings used
 * to wait in memory for the next one-second flush, so a restart, a deploy or
 * a crash lost whatever was waiting, and a database outage longer than the
 * in-memory buffer (50,000 rows) lost the oldest. Hourly production updates
 * were fire-and-forget: during an outage they failed and were gone.
 *
 * Now every accepted reading — its telemetry row and the hourly production it
 * adds — is written here first (fsync every `fsyncMs`), and the writer
 * (flusher.js) moves it into the database in one transaction together with
 * the journal position it reached (`ingest_checkpoint`). After a restart the
 * writer carries on from that position: nothing written twice, nothing lost.
 *
 * "Accepted" means: written and fsynced in this journal. MQTT QoS1
 * acknowledgement waits for syncThrough(), so an interrupted admission can
 * replay from the broker. QoS0 cannot give that transport recovery guarantee.
 *
 * Layout: dir/seg-<first seq>.ndjson, one JSON record per line, each with a
 * sequence number `s` that only ever grows (microseconds since the epoch, or
 * one more than the last, whichever is larger). A segment is deleted once
 * every record in it is in the database.
 */
import fs from 'fs';
import path from 'path';

const SEG_RE = /^seg-(\d+)\.ndjson$/;
const READ_CHUNK = 4 * 1024 * 1024;

function writeAll(fd, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  for (let offset = 0; offset < bytes.length;) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) throw new Error('Journal write made no progress');
    offset += written;
  }
}

export function createJournal({
  dir,
  segmentMaxRecords = 20_000,
  segmentMaxAgeMs = 60_000,
  fsyncMs = 100,
  maxBytes = 2 * 1024 ** 3,
  maxRecordBytes = 256 * 1024,
  quarantineMaxBytes = 256 * 1024 ** 2,
  log = () => {}
} = {}) {
  if (!dir) throw new Error('journal: dir is required');

  /** @type {Array<{name:string, file:string, firstSeq:number, bytes:number, fd:number|null}>} */
  let segments = [];
  let active = null;             // the segment being appended to
  let activeOpenedAt = 0;
  let activeRecords = 0;
  let lastSeq = 0;
  let totalBytes = 0;
  let dirty = false;
  let syncTimer = null;
  let cursor = { seg: 0, offset: 0 };   // first record not yet in the database
  let appended = 0, acked = 0, recovered = 0, refused = 0;
  const waiters = new Set();
  let durableSeq = 0;
  let syncWork = null;
  let fatalError = null;
  let corrupt = 0;
  const latest = new Map();
  const stateSeq = new Map();
  const stateFile = path.join(dir, 'state.json');
  const quarantineFile = path.join(dir, 'quarantine.ndjson');
  function quarantine(record, meta = {}) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...meta, record }) + '\n';
    const current = fs.existsSync(quarantineFile) ? fs.statSync(quarantineFile).size : 0;
    if (current + Buffer.byteLength(line) > quarantineMaxBytes) throw new Error('Journal quarantine is full; manual recovery required');
    const fd = fs.openSync(quarantineFile, 'a', 0o600);
    try { writeAll(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function rememberState(record) {
    if (record?.state?.machine_id && record.s >= (stateSeq.get(record.state.machine_id) || 0)) {
      latest.set(record.state.machine_id, record.state);
      stateSeq.set(record.state.machine_id, record.s);
    }
  }
  function parseRecord(line, meta) {
    try {
      if (Buffer.byteLength(line) > maxRecordBytes) throw new Error('oversized record');
      const record = JSON.parse(line);
      if (!Number.isSafeInteger(record.s) || record.s <= 0) throw new Error('invalid sequence');
      return record;
    } catch {
      quarantine({ raw: line.slice(0, maxRecordBytes), truncated: Buffer.byteLength(line) > maxRecordBytes },
        { reason: 'corrupt_record', ...meta });
      corrupt++;
      log('error', 'journal: corrupt record quarantined before advancing', meta);
      return null;
    }
  }

  const segFile = name => path.join(dir, name);

  function openSegment(firstSeq) {
    const name = `seg-${String(firstSeq).padStart(17, '0')}.ndjson`;
    const file = segFile(name);
    const fd = fs.openSync(file, 'a', 0o600);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    const seg = { name, file, firstSeq, bytes: 0, fd };
    segments.push(seg);
    active = seg;
    activeOpenedAt = Date.now();
    activeRecords = 0;
    return seg;
  }

  function closeActive() {
    if (!active || active.fd == null) return;
    try { fs.fsyncSync(active.fd); durableSeq = lastSeq; }
    catch (err) { fatalError = err; throw err; }
    fs.closeSync(active.fd);
    active.fd = null;
  }

  /** A torn last line (a crash mid-write) is cut off; complete lines are kept. */
  function recoverSegment(seg) {
    const fd = fs.openSync(seg.file, 'r');
    const size = fs.fstatSync(fd).size;
    const chunk = Buffer.alloc(64 * 1024);
    let offset = 0, end = 0, lineBytes = 0, pieces = [], count = 0;
    try {
      while (offset < size) {
        const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
        if (!n) break;
        let from = 0;
        for (let i = 0; i < n; i++) {
          if (chunk[i] !== 0x0a) continue;
          lineBytes += i - from;
          if (lineBytes <= maxRecordBytes) {
            pieces.push(Buffer.from(chunk.subarray(from, i)));
            try {
              const record = JSON.parse(Buffer.concat(pieces).toString('utf8'));
              if (Number.isSafeInteger(record.s) && record.s > 0) {
                lastSeq = Math.max(lastSeq, record.s); rememberState(record); count++;
              }
            } catch { /* read() quarantines before advancing */ }
          }
          pieces = []; lineBytes = 0; from = i + 1; end = offset + from;
        }
        lineBytes += n - from;
        if (lineBytes <= maxRecordBytes) pieces.push(Buffer.from(chunk.subarray(from, n)));
        else pieces = [];
        offset += n;
      }
    } finally { fs.closeSync(fd); }
    if (end < size) {
      quarantine({ raw: Buffer.concat(pieces).toString('utf8'), truncated: lineBytes > maxRecordBytes },
        { reason: 'torn_record', segment: seg.name, offset: end, bytes: size - end });
      fs.truncateSync(seg.file, end);
      log('warn', 'journal: partial record quarantined and removed from segment', { segment: seg.name, bytes: size - end });
    }
    seg.bytes = end;
    recovered += count;
  }

  function nextSeq() {
    lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
    return lastSeq;
  }

  function scheduleSync() {
    dirty = true;
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      if (!dirty || !active || active.fd == null) return;
      dirty = false;
      const fd = active.fd;
      const through = lastSeq;
      fs.fsync(fd, err => {
        if (err && err.code !== 'EBADF') { fatalError = err; log('error', 'journal fsync failed; admission stopped', { error: err.message }); }
        else if (!err) durableSeq = Math.max(durableSeq, through);
      });
    }, fsyncMs);
    syncTimer.unref?.();
  }

  function rotateIfDue() {
    if (activeRecords === 0) return;
    if (activeRecords >= segmentMaxRecords || Date.now() - activeOpenedAt >= segmentMaxAgeMs) {
      closeActive();
      openSegment(lastSeq + 1);
    }
  }

  function wake() { for (const w of [...waiters]) w(); waiters.clear(); }

  function saveStates() {
    const records = [...latest].filter(([id]) => stateSeq.get(id) <= durableSeq).map(([id, state]) => ({ s: stateSeq.get(id), state }));
    const tmp = `${stateFile}.part`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { writeAll(fd, JSON.stringify(records)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, stateFile);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }

  /** Delete segments the cursor has moved past (never the active one). */
  function dropConsumed() {
    if (cursor.seg > 0) saveStates(); // retain accepted ordering/counters before removing their records
    while (cursor.seg > 0) {
      const seg = segments[0];
      if (seg === active) break;
      if (seg.fd != null) { try { fs.closeSync(seg.fd); } catch { /* closed */ } }
      try { fs.unlinkSync(seg.file); } catch (err) { log('warn', 'journal: could not delete a segment', { segment: seg.name, error: err.message }); }
      totalBytes -= seg.bytes;
      segments.shift();
      cursor = { seg: cursor.seg - 1, offset: cursor.offset };
    }
  }

  return {
    /** Read what is on disk and start a fresh segment to append to. */
    open() {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(stateFile)) {
        for (const record of JSON.parse(fs.readFileSync(stateFile, 'utf8'))) {
          if (!Number.isSafeInteger(record.s) || !record.state?.machine_id) throw new Error('Invalid journal state snapshot');
          rememberState(record); lastSeq = Math.max(lastSeq, record.s);
        }
      }
      const names = fs.readdirSync(dir).filter(n => SEG_RE.test(n)).sort();
      segments = names.map(name => ({ name, file: segFile(name), firstSeq: Number(SEG_RE.exec(name)[1]), bytes: 0, fd: null }));
      for (const seg of segments) recoverSegment(seg);
      durableSeq = lastSeq;
      totalBytes = segments.reduce((a, s) => a + s.bytes, 0);
      // an empty leftover segment is just removed
      segments = segments.filter(s => { if (s.bytes > 0) return true; try { fs.unlinkSync(s.file); } catch { /* gone */ } return false; });
      cursor = { seg: 0, offset: 0 };
      openSegment(Math.max(lastSeq + 1, Date.now() * 1000));
      if (recovered) log('info', 'journal: readings waiting from before the restart', { records: recovered, segments: segments.length - 1 });
      return { recovered, lastSeq };
    },

    /**
     * Write one record. Returns its sequence number, or 0 when it was refused
     * (journal full, or the disk would not take it) — the caller counts that.
     */
    append(record) {
      if (!active) throw new Error('journal is not open');
      if (fatalError) throw fatalError;
      if (!syncWork) rotateIfDue();
      const seq = nextSeq();
      const line = JSON.stringify({ ...record, s: seq }) + '\n';
      const size = Buffer.byteLength(line);
      if (size > maxRecordBytes || totalBytes + size > maxBytes) { refused++; return 0; }
      try {
        writeAll(active.fd, line);
      } catch (err) {
        refused++; fatalError = err;
        log('error', 'journal write failed', { error: err.message });
        return 0;
      }
      active.bytes += size;
      totalBytes += size;
      activeRecords++;
      rememberState({ ...record, s: seq });
      appended++;
      scheduleSync();
      if (!syncWork) rotateIfDue();
      wake();
      return seq;
    },

    /**
     * Up to `max` records from the cursor, and the position just after them.
     * The cursor itself only moves on ack(), once the database has them.
     */
    read(max = 1000) {
      const out = [];
      let seg = cursor.seg, offset = cursor.offset;
      while (out.length < max && seg < segments.length) {
        const s = segments[seg];
        if (offset >= s.bytes) {
          if (s === active) break;
          seg++; offset = 0; continue;
        }
        const len = Math.min(READ_CHUNK, s.bytes - offset);
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(s.file, 'r');
        try { fs.readSync(fd, buf, 0, len, offset); } finally { fs.closeSync(fd); }
        let from = 0;
        for (let i = 0; i < len && out.length < max; i++) {
          if (buf[i] !== 0x0a) continue;
          const line = buf.subarray(from, i).toString('utf8');
          from = i + 1;
          const record = parseRecord(line, { segment: s.name, offset: offset + from });
          if (record) out.push(record);
        }
        if (from === 0) {
          if (len < READ_CHUNK) break;
          // A pre-existing corrupt line can exceed the read buffer. Quarantine
          // bounded evidence, then scan chunks to its delimiter without retaining it in RAM.
          quarantine({ raw: buf.subarray(0, maxRecordBytes).toString('utf8'), truncated: true },
            { reason: 'oversized_record', segment: s.name, offset });
          corrupt++;
          offset += len;
          let ended = false;
          while (offset < s.bytes) {
            const tail = Buffer.alloc(Math.min(READ_CHUNK, s.bytes - offset));
            const tailFd = fs.openSync(s.file, 'r');
            try { fs.readSync(tailFd, tail, 0, tail.length, offset); } finally { fs.closeSync(tailFd); }
            const newline = tail.indexOf(0x0a);
            offset += newline < 0 ? tail.length : newline + 1;
            if (newline >= 0) { ended = true; break; }
          }
          if (!ended) break;
          continue;
        }
        offset += from;
      }
      return { records: out, position: { seg, offset }, advanced: seg !== cursor.seg || offset !== cursor.offset };
    },

    /** The database has everything before `position`: move the cursor and free space. */
    ack(position, count = 0) {
      cursor = { seg: position.seg, offset: position.offset };
      acked += count;
      dropConsumed();
    },

    /** Fsync before the broker is told the reading is accepted. */
    async syncThrough(seq) {
      if (fatalError) throw fatalError;
      while (durableSeq < seq) {
        if (!syncWork) {
          const fd = active.fd;
          const through = lastSeq;
          syncWork = new Promise((resolve, reject) => fs.fsync(fd, err => {
            if (err) { fatalError = err; reject(err); }
            else { durableSeq = Math.max(durableSeq, through); resolve(); }
          })).finally(() => { syncWork = null; });
        }
        await syncWork;
      }
    },
    latestStates() { return new Map(latest); },
    quarantine,

    /** Resolves when something is appended, or after `ms`. */
    waitForData(ms = 250) {
      return new Promise(resolve => {
        const t = setTimeout(() => { waiters.delete(done); resolve(); }, ms);
        const done = () => { clearTimeout(t); resolve(); };
        waiters.add(done);
      });
    },

    /** Ends every waitForData() now (shutdown). */
    wakeAll() { wake(); },

    /** Everything appended so far is on disk. */
    sync() {
      if (active?.fd != null) { fs.fsyncSync(active.fd); durableSeq = lastSeq; }
      dirty = false;
    },

    close() {
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      closeActive();
      wake();
    },

    stats() {
      return {
        segments: segments.length, bytes: totalBytes, last_seq: lastSeq,
        appended, acked, recovered, refused, corrupt, durable_seq: durableSeq, failed: !!fatalError,
        pending: Math.max(0, recovered + appended - acked)
      };
    },

    get lastSeq() { return lastSeq; }
  };
}
