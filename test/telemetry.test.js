'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),dgram=require('node:dgram'),http=require('node:http');
const {parseMavlinkFrames,decodeMavlinkMessage,crcX25}=require('../src/mavlink');
const {TelemetryAggregator}=require('../src/telemetry-aggregator');
const {TelemetryPublisher}=require('../src/telemetry-publisher');
const {startUdpForwarder}=require('../src/udp-forwarder');
const logger={info(){},warn(){},error(){},device(){}};
const extras={0:50,1:124,24:24,30:39,33:104,42:28};
function packet(id,p,seq=1,version=2,trim=false) {
  if(trim) {let n=p.length;while(n>1&&p[n-1]===0)n--;p=p.subarray(0,n);}
  const h=version===2?10:6,b=Buffer.alloc(h+p.length+2);b[0]=version===2?253:254;b[1]=p.length;
  if(version===2){b[4]=seq;b[5]=1;b[6]=1;b[7]=id;}else{b[2]=seq;b[3]=1;b[4]=1;b[5]=id;}
  p.copy(b,h);b.writeUInt16LE(crcX25(b.subarray(1,h+p.length),extras[id]??0),h+p.length);return b;
}
function decode(id,p,seq=1,version=2,trim=false){const b=packet(id,p,seq,version,trim);return [parseMavlinkFrames(b)[0],decodeMavlinkMessage(b,parseMavlinkFrames(b)[0])];}
function position(boot=1000){const p=Buffer.alloc(28);p.writeUInt32LE(boot);p.writeInt32LE(375500000,4);p.writeInt32LE(1284000000,8);p.writeInt32LE(123000,12);p.writeInt32LE(23000,16);p.writeInt16LE(300,20);p.writeInt16LE(400,22);p.writeUInt16LE(9000,26);return p;}
test('wire offsets, battery, GPS accuracy, attitude, mission and GPI normalization',()=>{
 const a=new TelemetryAggregator({eventId:'flight'});const accept=(id,p)=>a.accept(...decode(id,p),'127.0.0.1',1000);
 const hb=Buffer.alloc(9);hb[4]=2;hb[6]=128;hb[8]=3;assert.equal(accept(0,hb),null);
 const battery=Buffer.alloc(31);battery.writeUInt16LE(22200,14);battery[18]=99;battery[30]=78;accept(1,battery);
 const gps=Buffer.alloc(52);gps[28]=6;gps[29]=18;gps.writeUInt16LE(85,20);gps.writeUInt32LE(420,34);accept(24,gps);
 const attitude=Buffer.alloc(28);attitude.writeFloatLE(Math.PI/2,4);accept(30,attitude);
 accept(42,Buffer.from([7,0]));const t=accept(33,position());
 assert.equal(t.batteryPct,78);assert.equal(t.batteryVoltageV,22.2);assert.equal(t.horizontalAccuracyM,.42);assert.equal(t.groundSpeedMps,5);assert.equal(t.verticalSpeedMps,0);assert.equal(t.headingDeg,90);assert.equal(t.altitude,123);assert.equal(t.relativeAltitudeM,23);assert.equal(t.armed,true);assert.equal(t.missionSequence,7);assert.equal(t.positioningMethod,'RTK_FIXED');assert.equal(t.mavlinkVersion,2);assert.equal(t.mavlinkSigned,false);assert.equal(t.mavlinkSignatureVerified,false);assert.ok(Math.abs(t.rollDeg-90)<.001);
 assert.equal(accept(0,hb),null,'heartbeat cannot refresh an old position');assert.equal(accept(33,position()),null,'duplicate boot timestamp');
});
test('v1/v2 zero truncation, CRC corruption and non-position messages',()=>{
 for(const version of [1,2]) assert.equal(decode(33,position(),255,version)[1].lat,375500000);
 assert.equal(decode(42,Buffer.from([0,0]),0,2,true)[1].seq,0);
 const b=packet(33,position());b[15]^=1;assert.equal(decodeMavlinkMessage(b,parseMavlinkFrames(b)[0]),null);
 const overlong=packet(33,Buffer.concat([position(),Buffer.from([1])]));assert.equal(decodeMavlinkMessage(overlong,parseMavlinkFrames(overlong)[0]),null,'overlong known payload rejected');
 const a=new TelemetryAggregator();for(const id of [49,242])assert.equal(a.accept({systemId:1,componentId:1},{type:id===49?'GPS_GLOBAL_ORIGIN':'HOME_POSITION'},'local'),null);
 const [f,m]=decode(33,position());assert.equal(a.accept({...f,systemId:2},m,'local'),null);
});
test('GPS HDOP is not horizontal accuracy metres; invalid fix and coordinates rejected',()=>{
 const a=new TelemetryAggregator();const gps=Buffer.alloc(30);gps[28]=2;gps[29]=255;gps.writeUInt16LE(85,20);a.accept(...decode(24,gps),'local');
 assert.equal(a.accept(...decode(33,position()),'local'),null);
 gps[28]=3;a.accept(...decode(24,gps),'local');assert.equal(a.accept(...decode(33,position()),'local').horizontalAccuracyM,undefined);
});
test('UDP -> normalization -> HTTP -> matching Core acknowledgement; no forwarding',async(t)=>{
 let posted;const api=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{posted=JSON.parse(body);res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({data:posted}));});});
 await new Promise(r=>api.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>api.close(r)));
 const publisher=new TelemetryPublisher({enabled:true,endpoint:`http://127.0.0.1:${api.address().port}`,timeoutMs:500},logger);
 const f=await startUdpForwarder({listenHost:'127.0.0.1',listenPort:0,forwardEnabled:false},logger,{telemetry:{eventId:'flight'},onTelemetry:v=>publisher.offer(v)});t.after(()=>f.close());
 const sender=dgram.createSocket('udp4');t.after(()=>sender.close());
 await new Promise((r,j)=>sender.send(packet(33,position()),f.address.port,'127.0.0.1',e=>e?j(e):r()));
 for(let i=0;i<100&&!publisher.latest;i++)await new Promise(r=>setTimeout(r,5));
 await publisher.flush();assert.equal(posted.latitude,37.55);assert.equal(f.stats.telemetryCount,1);assert.equal(f.stats.validatedMessageCounts[33],1);assert.equal(f.stats.rejectedTelemetryFrames,0);assert.deepEqual(f.stats.telemetryIdentity,{systemId:1,componentId:1});assert.equal(publisher.stats.coreAccepted,1);assert.equal(f.stats.sendErrors,0);
});
test('backend unavailable and timeout do not stop reception; one in-flight request',async()=>{
 let calls=0,release;const publisher=new TelemetryPublisher({enabled:true,endpoint:'http://localhost',timeoutMs:100},logger,()=>{calls++;return new Promise((r,j)=>{release=()=>j(new Error('unavailable'));});});
 publisher.offer({assetId:'x',observedAt:new Date().toISOString()});const pending=publisher.flush();await publisher.flush();assert.equal(calls,1);release();await pending;assert.equal(publisher.stats.httpFailure,1);
 const server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const timeout=new TelemetryPublisher({enabled:true,endpoint:`http://127.0.0.1:${server.address().port}`,timeoutMs:30},logger);timeout.offer(publisher.latest);await timeout.flush();assert.equal(timeout.stats.httpFailure,1);server.closeAllConnections();await new Promise(r=>server.close(r));
});
test('reject direct UDP loop',async()=>{await assert.rejects(startUdpForwarder({forwardEnabled:true,listenHost:'0.0.0.0',listenPort:14551,targetHost:'127.0.0.1',targetPort:14551},logger),/loop/);});
module.exports={packet,position};
