# Hardware Configuration & Thermal Engineering Notes

> **Important Prototype Disclaimer:** This hardware architecture and cooling controller are for engineering prototyping and educational validation only. They are **not clinically validated** and must undergo formal thermal qualification and regulatory review before transporting real human blood products.

## ESP32-WROOM-32 Default Pinout (`config.example.h`)

| Component | ESP32 Pin | Notes |
|---|---|---|
| DS18B20 Temperature Probe | GPIO 4 | Requires 4.7kΩ pull-up resistor to 3.3V |
| GPS Neo-6M (UART2) | RX2: GPIO 16, TX2: GPIO 17 | 9600 baud; place ceramic patch antenna facing sky |
| Peltier + Fan Power Driver | GPIO 26 | Drives opto-isolated 12V relay or logic-level N-MOSFET (e.g., IRLZ44N + flyback diode) |
| Electronic Door Latch Servo | GPIO 27 | Separate 5V buck rail recommended to avoid ESP32 brownouts |
| Magnetic Reed Switch | GPIO 33 | `INPUT_PULLUP`; LOW when door closed, HIGH when door open |
| Buzzer / Green LED / Red LED | GPIO 25 / 12 / 14 | 220Ω series resistors for LEDs |
| 4x4 Matrix Keypad | Rows: 13,18,19,21 / Cols: 22,23,32,35 | GPIO 35 is input-only (valid for column scan with external pull-up or swap to output/input) |

## Power, Thermal & Enclosure Design Considerations

- **Power Driver:** Never drive a 12V TEC1-12706 Peltier module (~4A–6A) directly from an ESP32 GPIO. Use an opto-isolated relay or logic-level MOSFET rated ≥15A with proper gate resistor and flyback protection.
- **Heat Dissipation:** A Peltier transfers heat from the cold plate to the hot side plus its own electrical dissipation ($I^2R$). The hot side **must** have an adequately sized aluminum heatsink + active cooling fan; otherwise thermal soak will heat the chamber instead of cooling it.
- **Insulation & Thermal Mass:** Use closed-cell PU/EPS foam insulation (≥25–40 mm) and phase-change gel packs calibrated near `4°C–6°C` to buffer door openings and limit compressor/Peltier duty cycle.
- **Battery Sizing:** A 12V 6A Peltier at 50% duty cycle draws ~36W average (~3A at 12V). A 12V 12Ah LiFePO4 pack provides ~3.5–4 hours of active cooling; include low-voltage cutoff protection (`<11.2V`) via the extensible `battery` sensor channel.
- **Hysteresis Strategy:** Default `TEMP_MIN_C=4.0`, `TEMP_MAX_C=8.0`, `TEMP_HYSTERESIS_C=0.5`, and `PELTIER_MIN_SWITCH_INTERVAL_MS=30000` prevent rapid relay chatter and thermal stress.
