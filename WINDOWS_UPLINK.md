# Windows UDP / RTSP Uplink v1

## Quick start

개발 PC:

```powershell
Copy-Item .\config.example.json .\config.json
notepad .\config.json
npm test
npm start
```

현장 PC용 portable 패키지:

```powershell
npm run portable
```

생성되는 `portable` 폴더는 `node.exe`를 포함하므로 현장 PC에서 Node.js 설치나 `npm install`이 필요하지 않습니다.

1. `portable\config.json`에서 Workstation IP와 포트를 수정합니다.
2. 폴더 전체를 현장 GCS PC에 복사합니다.
3. `start.bat`을 더블클릭합니다.

## UDP

기본값:

- GCS/QGC → uplink: `127.0.0.1:14551`
- uplink → Workstation: `127.0.0.1:14550`

실제 차량 LAN에서는 `udp.targetHost`를 Workstation IPv4로 변경합니다.

UDP payload는 파싱하거나 재작성하지 않고 그대로 전달하므로 MAVLink 원본 프레임을 유지합니다.

## RTSP

v1은 외부 바이너리 설치를 없애기 위해 **RTSP-over-TCP/interleaved TCP proxy** 방식입니다.

기본값:

- Workstation client → GCS uplink: `GCS_IP:9554`
- uplink → local RTSP source: `127.0.0.1:8554`

실제 RTSP source가 확인되면:

```json
"rtsp": {
  "enabled": true,
  "listenHost": "0.0.0.0",
  "listenPort": 9554,
  "sourceHost": "실제_RTSP_SOURCE_IP",
  "sourcePort": 554
}
```

Workstation 쪽 RTSP client는 TCP transport를 사용해야 합니다. RTP/UDP media relay가 필요한 장비라면 별도 media relay 방식으로 확장합니다.

## Windows Firewall

외부 Workstation이 GCS의 RTSP proxy에 접속할 경우 관리자 PowerShell에서 필요 시:

```powershell
New-NetFirewallRule -DisplayName "Drone GCS RTSP Uplink 9554" -Direction Inbound -Protocol TCP -LocalPort 9554 -Action Allow
```

UDP는 QGC가 같은 GCS PC의 `127.0.0.1:14551`로 보내는 기본 구성에서는 인바운드 방화벽 개방이 필요하지 않습니다.

## Live telemetry -> Core

`config.json`에서 다음을 실제 현장 값으로 설정합니다.

```json
"telemetry": {
  "enabled": true,
  "systemId": 1,
  "componentId": 1,
  "endpoint": "https://api.forest.tobeunicorn.kr/api/v1/dashboard/telemetry/drone",
  "assetId": "MD1000-01",
  "eventId": "ACTIVE_EVENT_UUID",
  "assetType": "UAV",
  "intervalMs": 1000,
  "timeoutMs": 3000
}
```

`systemId/componentId`는 MAVLink 송신 주체의 ID입니다. 기본값 `1/1`에서 `validatedMessageCounts[33]`는 증가하지만 `telemetryCount`가 증가하지 않으면 `UPLINK_STATUS.devices`와 `logs/device-events-YYYY-MM-DD.jsonl`에서 실제 sender ID를 확인합니다.

상태 로그에서 구분해서 봅니다.

- `messageCounts`: 프레이밍된 원본 메시지 ID 수. CRC 실패 프레임도 포함될 수 있습니다.
- `validatedMessageCounts`: 지원 메시지 중 CRC 검증을 통과한 수.
- `rejectedTelemetryMessageCounts`: 알려진 telemetry message ID지만 CRC/길이 검증에 실패한 수.
- `telemetryIdentity`: 실제 위치 observation을 만든 `systemId/componentId`.
- `telemetryCount`: `GLOBAL_POSITION_INT(33)`에서 정상 위치 observation을 생성한 수.
- `telemetryPublisher.coreAccepted`: Core가 해당 observation을 정상 수락하고 동일 ID/시각으로 응답한 수.

MAVLink 2 packet signing flag가 있는 프레임도 CRC 검증 후 읽을 수 있지만, 현재 uplink는 13-byte MAVLink signature를 암호학적으로 검증하지 않습니다. 대시보드에는 signature 존재 여부와 검증 여부를 구분해서 표시합니다.
