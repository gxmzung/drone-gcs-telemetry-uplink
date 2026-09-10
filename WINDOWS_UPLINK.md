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
