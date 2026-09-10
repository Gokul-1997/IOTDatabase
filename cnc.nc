%
O0001 (Test Circle Program)
G21 (Set units to millimeters - use G20 for inches)
G90 (Absolute positioning distance mode)
G0 Z5.0 (Rapid move to clear Z height)
G0 X0.0 Y0.0 (Rapid move to origin)
M3 S1000 (Spindle on clockwise at 1000 RPM)
G1 Z-1.0 F100 (Feed down into material)
G2 X10.0 Y0.0 I5.0 J0.0 F200 (Clockwise arc)
G0 Z5.0 (Retract tool)
M5 (Spindle stop)
M30 (Program end and rewind)
%
