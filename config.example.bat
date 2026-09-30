@echo off

REM ===== GCS UDP / Core =====
set GCS_UDP_HOST=0.0.0.0
set GCS_UDP_PORT=14551
set TELEMETRY_SERVER_URL=http://127.0.0.1:18020/internal/v1/telemetry/drone

REM 실제 asset/drone ID가 필요한 경우 지정
REM set GCS_DRONE_ID=

REM ===== Evidence Log =====
set UPLINK_LOG_DIR=logs

REM 수락시험/장애분석 시 MAVLink frame 단위 로그 활성화
REM 장시간 운용 시 로그량이 커질 수 있으므로 필요할 때만 true
set UPLINK_DEVICE_LOG_ENABLED=false

REM ===== RTSP =====
REM 실제 RTSP source 확인 후 true
set RTSP_PROXY_ENABLED=false
set RTSP_LISTEN_HOST=0.0.0.0
set RTSP_LISTEN_PORT=9554
set RTSP_SOURCE_HOST=127.0.0.1
set RTSP_SOURCE_PORT=8554
