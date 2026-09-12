"use strict";
const degrees = value => Number.isFinite(value) ? value * 180 / Math.PI : undefined;
function positioningMethod(fix) {
  if (fix === 6) return "RTK_FIXED";
  if (fix === 5) return "RTK_FLOAT";
  if ([3,4].includes(fix)) return "GNSS";
  return fix == null ? undefined : "NO_FIX";
}
class TelemetryAggregator {
  constructor({assetId="MD1000-01",eventId,systemId=1,componentId=1}={}) {
    Object.assign(this,{assetId,eventId,systemId,componentId});
    this.state={};
  }
  accept(frame,message,sourceAddress,receivedAt=Date.now()) {
    if (!message || frame.systemId!==this.systemId || frame.componentId!==this.componentId) return null;
    const s=this.state;
    switch(message.type) {
      case "HEARTBEAT":
        if (message.vehicleType===6 || message.autopilot===8) return null;
        s.armed=!!(message.baseMode&128);
        s.flightMode=`CUSTOM_MODE ${message.customMode}`;
        s.lastHeartbeatAt=receivedAt;
        break;
      case "SYS_STATUS":
        s.batteryPct=message.batteryRemaining>=0&&message.batteryRemaining<=100?message.batteryRemaining:undefined;
        s.batteryVoltageV=message.voltageBatteryMv===65535?undefined:message.voltageBatteryMv/1000;
        break;
      case "GPS_RAW_INT":
        s.gpsFixType=message.fixType;
        s.positioningMethod=positioningMethod(message.fixType);
        s.satellitesVisible=message.satellitesVisible===255?undefined:message.satellitesVisible;
        // eph is HDOP, NOT metres. h_acc extension alone gives horizontal accuracy.
        s.horizontalAccuracyM=message.horizontalAccuracyMm>0?message.horizontalAccuracyMm/1000:undefined;
        break;
      case "ATTITUDE":
        s.rollDeg=degrees(message.rollRad);s.pitchDeg=degrees(message.pitchRad);s.yawDeg=degrees(message.yawRad);
        break;
      case "MISSION_CURRENT":s.missionSequence=message.seq;break;
      case "GLOBAL_POSITION_INT": {
        const latitude=message.lat/1e7, longitude=message.lon/1e7;
        if (!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) return null;
        if (s.gpsFixType!=null && s.gpsFixType<3) return null;
        if (s.lastBootMs===message.bootMs) return null;
        // A reboot/out-of-order sample cannot silently refresh a previous flight state.
        if (s.lastBootMs!=null && message.bootMs<s.lastBootMs) {this.state={};return null;}
        s.lastBootMs=message.bootMs;
        const observedAt=new Date(receivedAt).toISOString();
        const fields={relativeAltitudeM:message.relativeAltMm/1000,headingDeg:message.headingCdeg===65535?undefined:message.headingCdeg/100,
          groundSpeedMps:Math.hypot(message.vxCms,message.vyCms)/100,verticalSpeedMps:message.vzCms===0?0:-message.vzCms/100,batteryVoltageV:s.batteryVoltageV,
          armed:s.armed,flightMode:s.flightMode,missionSequence:s.missionSequence,gpsFixType:s.gpsFixType,
          satellitesVisible:s.satellitesVisible,rollDeg:s.rollDeg,pitchDeg:s.pitchDeg,yawDeg:s.yawDeg,
          systemId:frame.systemId,componentId:frame.componentId,source:"MAVLINK",mavlinkVersion:frame.version,mavlinkSigned:frame.signed===true,mavlinkSignatureVerified:false};
        return {assetId:this.assetId,eventId:this.eventId,assetType:"UAV",observedAt,receivedAt:observedAt,sequence:frame.sequence,
          latitude,longitude,altitude:message.altMm/1000,batteryPct:s.batteryPct,positioningMethod:s.positioningMethod,
          horizontalAccuracyM:s.horizontalAccuracyM,operationalStatus:receivedAt-(s.lastHeartbeatAt??0)>10000?"DEGRADED":s.armed?"FLYING":"READY",
          ...fields,attributes:{...fields,sourceAddress,timeBootMs:message.bootMs,timestampBasis:"UPLINK_RECEIVE_TIME"}};
      }
      default:return null;
    }
    // Only a NEW GLOBAL_POSITION_INT creates a position observation.
    return null;
  }
}
module.exports={TelemetryAggregator,positioningMethod};
