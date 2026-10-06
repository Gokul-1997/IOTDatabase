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
 * "Accepted" therefore means: in this journal, on disk. The only window left
 * is the time between the broker's acknowledgement and the next fsync
 * (≤ fsyncMs plus the handler's few milliseconds), and only for a crash or a
 * power cut — a normal stop syncs and drains first.
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

export function createJournal({
  dir,
  segmentMaxRecords = 20_000,
  segmentMaxAgeMs = 60_000,
  fsyncMs = 100,
  maxBytes = 2 * 1024 ** 3,
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

  const segFile = name => path.join(dir, name);

  function openSegment(firstSeq) {
    const name = `seg-${String(firstSeq).padStart(17, '0')}.ndjson`;
    const file = segFile(name);
    const fd = fs.openSync(file, 'a');
    const seg = { name, file, firstSeq, bytes: 0, fd };
    segments.push(seg);
    active = seg;
    activeOpenedAt = Date.now();
    activeRecords = 0;
    return seg;
  }

  function closeActive() {
    if (!active || active.fd == null) return;
    try { fs.fsyncSync(active.fd); } catch { /* best effort */ }
    fs.closeSync(active.fd);
    active.fd = null;
  }

  /** A torn last line (a crash mid-write) is cut off; complete lines are kept. */
  function recoverSegment(seg) {
    const buf = fs.readFileSync(seg.file);
    const end = buf.lastIndexOf(0x0a) + 1;           // just after the last newline
    if (end < buf.length) {
      fs.truncateSync(seg.file, end);
      log('warn', 'journal: cut a partial record off the end of a segment', { segment: seg.name, bytes: buf.length - end });
    }
    seg.bytes = end;
    let count = 0;
    for (let i = 0, from = 0; i < end; i++) {
      if (buf[i] !== 0x0a) continue;
      const line = buf.subarray(from, i).toString('utf8');
      from = i + 1;
      try { const r = JSON.parse(line); if (r.s > lastSeq) lastSeq = r.s; count++; }
      catch { /* skipped when read */ }
    }
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
      fs.fsync(fd, err => { if (err && err.code !== 'EBADF') log('error', 'journal fsync failed', { error: err.message }); });
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

  /** Delete segments the cursor has moved past (never the active one). */
  function dropConsumed() {
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
      const names = fs.readdirSync(dir).filter(n => SEG_RE.test(n)).sort();
      segments = names.map(name => ({ name, file: segFile(name), firstSeq: Number(SEG_RE.exec(name)[1]), bytes: 0, fd: null }));
      for (const seg of segments) recoverSegment(seg);
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
      const seq = nextSeq();
      const line = JSON.stringify({ ...record, s: seq }) + '\n';
      const size = Buffer.byteLength(line);
      if (totalBytes + size > maxBytes) { refused++; return 0; }
      try {
        fs.writeSync(active.fd, line);
      } catch (err) {
        refused++;
        log('error', 'journal write failed', { error: err.message });
        return 0;
      }
      active.bytes += size;
      totalBytes += size;
      activeRecords++;
      appended++;
      scheduleSync();
      rotateIfDue();
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
          try { out.push(JSON.parse(line)); }
          catch { log('error', 'journal: unreadable record skipped', { segment: s.name, offset: offset + from }); }
        }
        if (from === 0) break;                 // no complete line in this chunk yet
        offset += from;
      }
      return { records: out, position: { seg, offset } };
    },

    /** The database has everything before `position`: move the cursor and free space. */
    ack(position, count = 0) {
      cursor = { seg: position.seg, offset: position.offset };
      acked += count;
      dropConsumed();
    },

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
      if (active?.fd != null) { try { fs.fsyncSync(active.fd); } catch { /* best effort */ } }
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
        appended, acked, recovered, refused,
        pending: Math.max(0, recovered + appended - acked)
      };
    },

    get lastSeq() { return lastSeq; }
  };
}
