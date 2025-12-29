# Home Assistant System Architecture

## Network Topology

```
Internet
    │
    ├─── Cloudflare Tunnel (future)
    │    └─── ha.ooheynerds.com → 192.168.1.80:8123
    │
Local Network (192.168.1.x)
    │
    ├─── 192.168.1.80 (Home Assistant Yellow)
    │    ├─── Z-Wave (Home Assistant Connect ZWA-2)
    │    ├─── Zigbee/Thread (Yellow built-in)
    │    ├─── Wi-Fi clients
    │    └─── API (port 8123)
    │
    ├─── 192.168.1.240 (Unraid Tower)
    │    ├─── PostgreSQL (port 5432)
    │    ├─── Cloudflare Tunnel (alexandria)
    │    └─── Docker containers
    │
    ├─── Philips Hue Bridge
    │    └─── 30+ Hue bulbs & buttons
    │
    ├─── Sonos Speakers (5 zones)
    │    ├─── Living Room (Arc + Sub + Surrounds)
    │    ├─── Main Bedroom (Arc)
    │    ├─── Office
    │    ├─── Patio (Playbar)
    │    └─── Pool (Amp)
    │
    ├─── ESPHome Devices
    │    ├─── ratgdo32 f3a3b8 (single garage)
    │    ├─── ratgdov25i 0aff7d (double garage)
    │    └─── Seeed 6-Channel Relay (pool/outdoor)
    │
    ├─── Shelly Switches
    │    ├─── Pool pump controller
    │    └─── HVAC controls
    │
    ├─── Rachio (Sprinkler Controller)
    │    └─── 12 irrigation zones
    │
    ├─── Roborock Qrevo Edge (vacuum)
    │
    ├─── Google Nest Devices
    │    ├─── Kitchen Display
    │    ├─── Office Display (Nest Hub Max)
    │    ├─── Main Bedroom Display
    │    └─── Various speakers
    │
    └─── Mobile Devices
         ├─── justin_15pm (iPhone 15 Pro Max)
         ├─── justin_16p (iPhone 16 Pro)
         └─── justin_16p256 (iPhone 16 Pro 256GB)
```

---

## Communication Protocols

### Wireless
- **Wi-Fi**: Sonos, Roborock, ESPHome, Shelly, Google Nest, mobile devices
- **Zigbee**: Philips Hue bulbs & buttons (via Hue Bridge)
- **Z-Wave**: Future devices via Home Assistant Connect ZWA-2
- **Thread**: Yellow has built-in Thread radio (unused)
- **Matter**: Support available but not configured

### Wired
- **Ethernet**: Home Assistant Yellow, Unraid Tower, potentially some Sonos/Hue

### Cloud
- **Home Assistant Cloud**: Nabu Casa subscription for remote access, Alexa, Google Assistant
- **Philips Hue Cloud**: For remote Hue control
- **Sonos Cloud**: For music services
- **Rachio Cloud**: For irrigation management
- **Roborock Cloud**: For vacuum control

---

## Data Flow Patterns

### Current State

```
User Device (iPhone/Browser)
    ↓
Home Assistant Web UI (192.168.1.80:8123)
    ↓
Home Assistant Core
    ↓ ↓ ↓
    ├─→ Hue Bridge → Hue Lights/Buttons
    ├─→ Sonos API → Speakers
    ├─→ ESPHome API → Garage doors, Relays
    ├─→ Shelly HTTP → Switches
    ├─→ Rachio Cloud → Sprinklers
    ├─→ Roborock Cloud → Vacuum
    └─→ Mobile App Integration → iPhone tracking
```

### With BooksTrack Integration (Future)

```
BooksTrack iOS App (books-v3)
    ↓
BendV3 API (bendv3.ooheynerds.com)
    ↓
Alexandria Worker (alexandria.ooheynerds.com)
    ↓
Home Assistant API (ha.ooheynerds.com)
    ↓
Trigger automations:
    - Lights (reading mode)
    - Audio (ambient sounds)
    - Notifications (reading goals)
    - Scenes (book club mode)
```

---

## API Endpoints

### Home Assistant REST API

```bash
# Base URL
http://192.168.1.80:8123/api/

# Authentication
Authorization: Bearer YOUR_LONG_LIVED_TOKEN

# Key endpoints
GET  /api/states                    # All entity states
GET  /api/states/<entity_id>        # Single entity
POST /api/services/<domain>/<service>  # Call service
GET  /api/config                    # System configuration
GET  /api/events                    # Event stream
```

### Example Service Calls

```bash
# Turn on office lights
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.office"}' \
  http://192.168.1.80:8123/api/services/light/turn_on

# Set Hue scene
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "scene.office_relax"}' \
  http://192.168.1.80:8123/api/services/scene/turn_on

# Start vacuum
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "vacuum.roborock_qrevo_edge"}' \
  http://192.168.1.80:8123/api/services/vacuum/start
```

---

## Security Architecture

### Current Access Methods
1. **Local Network**: Direct access at 192.168.1.80:8123
2. **SSH**: root@192.168.1.80 (port 22, key-based auth)
3. **Home Assistant Cloud**: Remote access via ui.nabu.casa

### Authentication
- **Web UI**: Username/password (justin/tommyboy)
- **API**: Long-lived access token (Bearer auth)
- **SSH**: Public key authentication (~/.ssh/id_ed25519)

### Planned Improvements
- **Cloudflare Tunnel**: Expose ha.ooheynerds.com
- **API Gateway**: Route through BendV3 for BooksTrack integration
- **Rate Limiting**: Protect API endpoints
- **Audit Logging**: Track automation triggers from external services

---

## Integration Points with BooksTrack

### Potential Use Cases

1. **Reading Mode Automation**
   - Trigger: Open book in BooksTrack app
   - Actions:
     - Dim office lights to reading level
     - Set "focus" scenes in reading areas
     - Enable "Do Not Disturb" mode
     - Start ambient audio on Sonos

2. **Reading Goal Celebrations**
   - Trigger: Complete reading goal/milestone
   - Actions:
     - Flash lights in celebratory colors
     - Play congratulatory sound on Sonos
     - Send notification to Google Nest displays

3. **Book Club Mode**
   - Trigger: Start book club session
   - Actions:
     - Set living room lights to "energize"
     - Ensure Sonos is ready for music/podcasts
     - Create scene for social gathering

4. **Bedtime Reading Routine**
   - Trigger: Open book at night (after 9pm)
   - Actions:
     - Gradual dimming of bedroom lights
     - Warm color temperature (Hue)
     - Start sleep timer for audio

5. **Reading Statistics Dashboard**
   - Display BooksTrack stats on Google Nest Hub displays
   - Show "currently reading" on smart displays
   - Daily reading time vs smart home activity correlation

### Implementation Approach

**Option A: Webhooks (Simple)**
```javascript
// In BooksTrack app, trigger webhook when book opened
await fetch('https://ha.ooheynerds.com/api/services/script/turn_on', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    entity_id: 'script.reading_mode'
  })
});
```

**Option B: MQTT (Advanced)**
- BooksTrack → Mosquitto MQTT → Home Assistant
- Bi-directional communication
- Real-time state updates

**Option C: Via BendV3 Gateway**
- BooksTrack → BendV3 → Home Assistant
- Centralized logging and rate limiting
- Authentication through existing system

---

## Maintenance & Monitoring

### Health Checks
- Monitor battery levels (Hue buttons < 30%)
- Track unavailable devices
- Check Cloudflare Tunnel status
- Verify mobile device connectivity

### Backup Strategy
- **Automatic backups**: Daily at 2:01 AM
- **Manual backups**: Before major changes
- **Config stored**: /config directory on Yellow
- **Snapshot frequency**: Weekly full backups

### Update Management
- Home Assistant Core: Check for updates weekly
- Add-ons: Auto-update enabled
- ESPHome devices: Manual OTA updates
- Hue firmware: Auto-update via bridge

---

## Future Enhancements

### Short-term
1. ✅ Expose Home Assistant via Cloudflare Tunnel
2. ✅ Document all devices and automations
3. 🔄 Fix unavailable devices (Shelly, Hue lamps)
4. 🔄 Replace low batteries in Hue switches

### Medium-term
1. Integrate with BooksTrack for reading automations
2. Create custom dashboard for reading stats
3. Build MQTT bridge for real-time communication
4. Add Thread/Matter devices for better local control

### Long-term
1. Consolidate all services under single domain
2. Build unified mobile app with HA + BooksTrack
3. Implement AI-driven automation suggestions
4. Create voice control for reading features
