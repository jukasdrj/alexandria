# Home Assistant Inventory

**Last Updated**: 2025-12-27  
**Home Assistant Version**: 2025.12.3  
**Device**: Home Assistant Yellow (aarch64)  
**Location**: 1005 Dogwood Ct, Colleyville, TX 76034

---

## Overview Statistics

- **Total Entities**: 500+
- **Active Automations**: 8
- **Total Lights**: 30+ Philips Hue bulbs
- **Audio Zones**: 5 Sonos systems
- **Mobile Devices**: 3 iPhones tracked
- **Smart Buttons**: 5 Hue switches
- **Garage Doors**: 2 RATGDO controllers
- **Irrigation Zones**: 12 Rachio zones
- **Robot Vacuum**: 1 Roborock Qrevo Edge

---

## Lighting (Philips Hue)

### Master Bedroom (MumDad)
- **mumdad** (group) - Main bedroom lighting
- **mumbed** - Mum's bedside
- **dadbed** - Dad's bedside
- **Mum**, **Dad** - Individual color lamps
- **Read1**, **Read2**, **Read3** - Reading lights

### Kids' Rooms
- **oliver** (group) - Oliver's room
  - Oliver1, Oliver2, Oliver3, Oliver4 - Individual lamps
- **owen** (group) - Owen's room
  - Owen 1, Owen 2, Owen 3, Owen 4 - Individual lamps
- **elliot** (group) - Elliot's room
  - Elliot1, Elliot2, Elliot3, Elliot4 - Individual lamps

### Common Areas
- **LIV** (group) - Living room
  - Liv 1, Liv 2, Liv 3, Liv 4
- **office** (group) - Office
  - Office lamp
  - Office desk lamp plug
  - Office Justin plug (unavailable)
  - Desk lamp (unavailable)

### Exterior
- **front_door** - Front entrance light
- **Cactus lamp** (unavailable)
- **Porch1** (unavailable)

---

## Audio System (Sonos)

### Living Room
- **Living Room** (Sonos system with Arc/Sub/Surrounds)
- Features: Surround sound, subwoofer, speech enhancement, night sound
- Status: Idle

### Main Bedroom
- **MumDadBath** (Sonos Arc soundbar)
- **Main Bedroom Display** (Google Nest Hub)
- Status: Idle

### Office
- **Office** (Sonos speaker)
- **Office Display** (Google Nest Hub Max)
- Status: Idle

### Outdoor
- **SonosPatioPlaybar** - Patio/outdoor entertainment
- **SonosPoolAmp** - Pool area amplifier with speakers
- Status: Both idle

---

## Smart Controls & Buttons

### Hue Smart Buttons
- **dadDot** (Button 1) - Dad's quick control (100% battery)
- **mumDot** (Button 1) - Mum's quick control (100% battery)
- **Office light switch** (4 buttons) - 100% battery
- **Olivia light switch** - 47% battery ⚠️
- **Owen light switch** - 54% battery ⚠️

---

## Garage & Doors

### Garage Door Controllers (RATGDO)
- **ratgdo32 f3a3b8** - Single garage door
  - Status: Closed
  - Openings: 25
  - Features: Light control, motion sensor, obstruction detection
  
- **ratgdov25i 0aff7d** - Double garage door
  - Status: **OPEN** ⚠️
  - Openings: 73
  - Features: Light control, motion sensor, obstruction detection

---

## Irrigation System (Rachio)

**System**: Rachio-Home (Base Station CA562221)  
**Status**: Connected, no active watering

### Zones (All currently off)
1. **AC Yard**
2. **BackFence & Yard**
3. **Driveway**
4. **Food Garden**
5. **Front Flower**
6. **Front Yard**
7. **Pool Gardens**
8. **Pool House Grass**
9. **Pool**
10. **Rear Grass & Garage Bed**

### Schedules
- **Flex Schedule** (off)
- **Garden Schedule** (off)
- **Shade Garden Schedule** (off)

---

## Robot Vacuum

**Model**: Roborock Qrevo Edge  
**Status**: Docked and charging (100% battery)  
**Last Cleaning**: 2025-12-15 (12 days ago)

### Stats
- Total cleaning area: 1,231.8 m²
- Total cleaning sessions: 34
- Total cleaning time: 108,943 minutes (~1,815 hours)

### Features
- Mop attached and water box attached
- Do not disturb: 22:00 - 08:00
- Current room detection: Dining room
- Multiple cleaning modes available

---

## Mobile Devices

### justin_15pm (iPhone 15 Pro Max)
- Location: Home (1005 Dogwood Ct)
- Battery: 100% (Not Charging)
- Connection: Wi-Fi (babyyoda)
- Steps today: 2,599
- Activity: Stationary
- Storage: 42.27 GB used

### justin_16p (iPhone 16 Pro)
- Location: Home
- Battery: 100% (Not Charging)
- Connection: Wi-Fi (beepbeep)
- Steps today: 2,932
- Storage: 7.43 GB used
- Audio: Built-in Speaker

### justin_16p256 (iPhone 16 Pro 256GB)
- Location: Home
- Battery: 100% (Full)
- Connection: Unavailable
- Status: Mostly offline

---

## Media Players & Displays

### Google Nest Devices
- **Kitchen Display** (off)
- **Main Bedroom Display** (off)
- **Office Display** (Nest Hub Max - off)
- **Pixel Tablet** (off)

### Speakers
- **Elliot speaker** (Nest Audio - off)
- **Oliver room speaker** (off)
- **Olivia Bedroom speaker** (off)
- **Owen speaker** (off)

### TVs
- **LG webOS TV OLED65C4PUA** (65" OLED - off)
- **Olivia TV** (unavailable)

---

## Smart Relays & Switches

### ESPHome Devices
- **Seeed Studio 6 Channel Relay** (8a5f24)
  - All 6 relays currently off
  - Purpose: Pool/outdoor equipment control

### Shelly Switches
- **shelly1g4_a085e3c9b754** - PoolPumpCtrlThermo (unavailable)
- **shelly1g4_ccba97c9af30** - PoolShellyLEDSwitch (unavailable)
- **shellyuphvac** - HVAC control (unavailable)

---

## Other Devices

### Z-Wave
- **Home Assistant Connect ZWA-2** - Z-Wave controller (ready)

### Printer
- **HP ColorLaserJet MFP M282-M285** (unavailable)
  - Cartridges: Black, Cyan, Magenta, Yellow (all unavailable)

### Voice Assistants
- Google Assistant integration active
- Alexa integration active
- Apple TV remotes

---

## Active Automations

1. ✅ **Front nite** - Front door lighting automation
2. ✅ **dadDot** - Dad's button automation
3. ✅ **mumDot** - Mum's button automation  
4. ✅ **Office light switch** - Office controls
5. ✅ **Olivia light switch** - Olivia's room controls
6. ✅ **Owen light switch** - Owen's room controls
7. ❌ **Coming home** (disabled)
8. ❌ **Go to sleep 1** (disabled)
9. ❌ **Wake up** (disabled)

---

## Current Issues & Warnings

⚠️ **Battery Warnings**
- Olivia light switch: 47% battery
- Owen light switch: 54% battery

⚠️ **Open Doors**
- Double garage door is currently OPEN

⚠️ **Unavailable Devices**
- Multiple Shelly switches offline
- Several Hue lamps unavailable (Elliot1, Elliot2, Elliot3, Porch1, Desk lamp, etc.)
- HP Printer offline
- Some Sonos speakers duplicated/unavailable

🔧 **Maintenance Needed**
- Roborock sensor time: -943 (needs cleaning/replacement)

---

## Integration Summary

**Active Integrations**:
- Philips Hue (lighting & buttons)
- Sonos (whole home audio)
- Rachio (irrigation)
- Roborock (vacuum)
- ESPHome (custom devices)
- Z-Wave (smart home protocol)
- Mobile App (iOS devices)
- Google Assistant
- Apple TV
- Shelly (relays)
- Met.no (weather)
- Cloudflare (tunnel)

**Cloud Services**:
- Home Assistant Cloud (Nabu Casa)
- Google Translate TTS
- Cloud STT/TTS services
