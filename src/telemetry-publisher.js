"use strict";
class TelemetryPublisher {
  constructor(config,logger,fetchImpl=globalThis.fetch) {
    Object.assign(this,{config,logger,fetchImpl});
    this.latest=null;this.lastSent=null;this.timer=null;this.inFlight=false;
    this.stats={offered:0,httpSuccess:0,coreAccepted:0,httpFailure:0,lastSuccessAt:null,lastError:null};
  }
  offer(value) {this.latest=value;this.stats.offered++;}
  start() {
    if (!this.config.enabled||this.timer) return;
    this.timer=setInterval(()=>void this.flush(),this.config.intervalMs);
    this.timer.unref?.();
    this.logger.info("TELEMETRY_PUBLISHER_STARTED",{intervalMs:this.config.intervalMs,timeoutMs:this.config.timeoutMs});
  }
  async flush() {
    const value=this.latest;
    if (!this.config.enabled||this.inFlight||!value||value===this.lastSent) return;
    this.inFlight=true;
    try {
      const response=await this.fetchImpl(this.config.endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-Origin":"drone-gcs-telemetry-uplink"},body:JSON.stringify(value),signal:AbortSignal.timeout(this.config.timeoutMs)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.stats.httpSuccess++;
      const body=await response.json();
      if (body?.data?.assetId!==value.assetId || body.data.observedAt!==value.observedAt) throw new Error("Core acknowledgement does not match observation");
      this.stats.coreAccepted++;this.lastSent=value;
      this.stats.lastSuccessAt=new Date().toISOString();this.stats.lastError=null;
      this.logger.info("CORE_TELEMETRY_ACCEPTED",{assetId:value.assetId,observedAt:value.observedAt});
    } catch(error) {
      this.stats.httpFailure++;this.stats.lastError=error instanceof Error?error.message:String(error);
      this.logger.error("TELEMETRY_SEND_FAILED",{assetId:value.assetId,error:this.stats.lastError});
    } finally {this.inFlight=false;}
  }
  stop() {clearInterval(this.timer);this.timer=null;}
}
module.exports={TelemetryPublisher};
