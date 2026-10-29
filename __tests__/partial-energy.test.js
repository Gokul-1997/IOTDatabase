import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTelemetry } from '../src/lib/admission.js';
import { createMessageProcessor } from '../src/lib/message-processor.js';
import { createJournal } from '../src/lib/journal.js';
import { METER_FIELDS } from '../src/lib/power-signals.js';
const time=Math.floor(Date.now()/1000)-100;
const packet=p=>({topic:'machines/device/telemetry',payload:Buffer.from(JSON.stringify(p))});
const shifts={shiftFor:()=>1,shiftsOf:()=>[{id:1,start:0,end:86399}]};
function fixture(previous=null,customJournal=null){
 const records=[],publish=jest.fn();
 const processor=createMessageProcessor({journal:customJournal||{append:r=>{records.push(r);return records.length;},syncThrough:async()=>{}},
 lookupMachine:async()=>({id:7,company_id:4,controller_type:'FANUC'}),hydrate:async()=>previous,shifts,
 redis:{isReady:true,multi:()=>{publish();throw new Error('No CNC publication expected');}}});
 return {records,processor,publish,send:(offset,p)=>processor.handleMessage('device',p,(time+offset)*1000)};
}
test.each([{PowerData:{Total_kW:-0.955}},{EnergyFormatted:3104},{EnergyData:{Total_kWh:3104}},{PowerData:{Voltage_V1N:0}},{power:0}])('one electrical field without time is accepted: %j',async p=>{
 expect(parseTelemetry(packet(p),time*1000)?.payload).toBeDefined();const f=fixture();await f.send(0,p);
 expect(f.records[0].m).toMatchObject({at:time,standalone:true});expect(f.records[0].r).toBeUndefined();
 expect(f.records[0].a).toBeUndefined();expect(f.records[0].h).toEqual([]);expect(f.processor.state(7).received_at).toBeUndefined();expect(f.publish).not.toHaveBeenCalled();
});
test.each([{}, {PowerData:{}},{PowerData:{Total_kW:'unknown'}},{EnergyFormatted:true},{machine_status:'RUN'},{time:null,EnergyFormatted:3104},{time:time+200,EnergyFormatted:3104}])('invalid packet cannot acquire a server timestamp: %j',p=>{
 expect(parseTelemetry(packet(p),time*1000)).toBeNull();
});
test.each(METER_FIELDS)('individual %s persists without other fields',async(column,key)=>{
 const f=fixture();await f.send(0,{PowerData:{[key]:7}});expect(f.records[0].m.reading[column]).toBe(7);
});
test('independent energy leaves CNC runtime, alarms, counters and freshness untouched',async()=>{
 const f=fixture();await f.send(0,{time,machine_status:'RUN',parts_count:100,stat_alarm:1,alarm_code:'EX1'});const before=f.processor.state(7);
 await f.send(5,{time:time+5,EnergyData:{Total_kWh:3104}});
 expect(f.processor.state(7)).toMatchObject({received_at:time,machine_status:before.machine_status,parts_count:100,alarm_codes:before.alarm_codes,fingerprint:before.fingerprint});
 await f.send(7,{time:time+7,PowerData:{Average_Voltage_LL:217.12}});
 expect(f.processor.state(7).meter_values).toMatchObject({kwh_total:3104,v_ll_avg:217.12});
 expect(f.processor.state(7).meter_observed_at).toMatchObject({kwh_total:time+5,v_ll_avg:time+7});
 await f.send(10,{time:time+10,machine_status:'RUN',parts_count:101});const h=f.records.flatMap(r=>r.h||[]);
 expect(h.reduce((s,r)=>s+r.run,0)).toBe(10);expect(h.reduce((s,r)=>s+r.produced,0)).toBe(1);expect(f.processor.state(7).energy_meter).toBe(3104);
});
test('meter-only counter delta is allocated once without CNC time/parts',async()=>{
 const f=fixture();await f.send(0,{time,EnergyFormatted:100});await f.send(10,{time:time+10,EnergyData:{Total_kWh:101}});await f.send(10,{time:time+10,EnergyData:{Total_kWh:101}});
 expect(f.records).toHaveLength(2);const h=f.records.flatMap(r=>r.h);expect(h.reduce((s,r)=>s+r.energy,0)).toBe(1);expect(h.every(r=>r.run===0&&r.idle===0&&r.produced===0)).toBe(true);
});
test('long change-only gaps retain measured energy without guessing a shift',async()=>{
 const f=fixture();await f.send(0,{time,EnergyFormatted:100});await f.send(90,{time:time+90,EnergyFormatted:101});
 expect(f.records[1].h).toEqual([]);expect(f.records[1].gap).toMatchObject({unallocated_energy:1,known_state_seconds:0,received_at:new Date((time+90)*1000).toISOString()});expect(f.processor.state(7).unallocated_energy).toBe(1);
});
test('meter ordering does not reject a separately delayed CNC snapshot',async()=>{
 const f=fixture();await f.send(0,{time,machine_status:'RUN',parts_count:100,Energy:100});await f.send(10,{time:time+10,EnergyFormatted:101});
 await f.send(12,{time:time+5,machine_status:'RUN',parts_count:101,Energy:100.5});expect(f.records[2].r.parts_count).toBe(101);expect(f.processor.state(7).energy_meter).toBe(101);expect(f.processor.state(7).energy_meter_at).toBe(time+10);
});
test('different electrical fields arriving inside 15 seconds are never throttled',async()=>{
 const f=fixture();await f.send(0,{time,machine_status:'RUN',PowerData:{Total_kW:1}});await f.send(1,{time:time+1,machine_status:'RUN',PowerData:{Frequency:50}});
 expect(f.records.map(r=>r.m?.reading.frequency_hz)).toEqual([null,50]);
});
test('restart recovers an independent energy baseline without inventing a CNC timestamp',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'partial-energy-'));let journal=createJournal({dir});journal.open();
 try{await fixture(null,journal).send(0,{time,EnergyFormatted:100});journal.close();journal=createJournal({dir});journal.open();const f=fixture(null,journal);await f.send(10,{time:time+10,EnergyFormatted:101});
 expect(journal.read(10).records.at(-1).h.reduce((s,r)=>s+r.energy,0)).toBe(1);expect(f.processor.state(7).received_at).toBeUndefined();
 }finally{journal.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a conflicting same-second full snapshot cannot lower an independent energy baseline',async()=>{
 const f=fixture();await f.send(0,{time,machine_status:'RUN',Energy:100});
 await f.send(10,{time:time+10,EnergyFormatted:101});
 await f.send(10,{time:time+10,machine_status:'RUN',Energy:100.5});
 await f.send(11,{time:time+11,EnergyFormatted:101.5});
 expect(f.records.flatMap(r=>r.h||[]).reduce((s,r)=>s+r.energy,0)).toBe(1.5);
 expect(f.processor.state(7).energy_meter).toBe(101.5);
});
